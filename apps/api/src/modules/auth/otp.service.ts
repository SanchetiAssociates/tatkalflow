import { randomUUID } from "node:crypto";
import { maskMobile } from "@tatkalflow/shared";
import type { AppConfig } from "../../config.js";
import type { Db } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { generateOtpCode, hmacSha256Hex, safeEqualHex } from "../../lib/crypto.js";
import { Errors } from "../../lib/errors.js";
import { AuditActions, type AuditService } from "../audit/audit.service.js";
import type { OTPProvider } from "../otp/otp-provider.js";

export interface RequestContext {
  ipHash: string | null;
  userAgent: string | null;
}

type OtpConfig = Pick<
  AppConfig,
  | "OTP_HASH_PEPPER"
  | "OTP_TTL_SECONDS"
  | "OTP_MAX_VERIFY_ATTEMPTS"
  | "OTP_RESEND_COOLDOWN_SECONDS"
  | "OTP_MAX_SENDS_PER_SESSION"
  | "OTP_MAX_REQUESTS_PER_MOBILE_PER_HOUR"
  | "OTP_MAX_REQUESTS_PER_IP_PER_HOUR"
  | "OTP_LOCKOUT_THRESHOLD"
  | "OTP_LOCKOUT_MINUTES"
>;

const HOUR_MS = 3_600_000;

/**
 * Issues and verifies one-time codes.
 *
 * - Codes are stored only as HMAC-SHA256(pepper, sessionId:code); the pepper
 *   lives in the environment, so a database leak alone does not reveal codes.
 * - Verification attempts are counted with an atomic conditional update, so
 *   parallel guesses cannot exceed the attempt limit.
 * - Resends keep the same session and attempt counter: resending never grants
 *   extra guesses.
 */
export class OtpService {
  constructor(
    private readonly db: Db,
    private readonly provider: OTPProvider,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly config: OtpConfig,
  ) {}

  private hash(sessionId: string, code: string): string {
    return hmacSha256Hex(this.config.OTP_HASH_PEPPER, `${sessionId}:${code}`);
  }

  private newCode(): string {
    return this.provider.fixedCode?.() ?? generateOtpCode();
  }

  async request(mobile: string, ctx: RequestContext) {
    const now = this.clock.now();
    await this.enforceRequestLimits(mobile, ctx, now);

    // Only one live code per mobile: older pending codes stop working.
    await this.db.otpSession.updateMany({
      where: { mobile, status: "PENDING" },
      data: { status: "EXPIRED" },
    });

    const id = randomUUID();
    const code = this.newCode();
    const expiresAt = new Date(now.getTime() + this.config.OTP_TTL_SECONDS * 1000);
    await this.db.otpSession.create({
      data: {
        id,
        mobile,
        codeHash: this.hash(id, code),
        expiresAt,
        maxAttempts: this.config.OTP_MAX_VERIFY_ATTEMPTS,
        lastSentAt: now,
        // Rate-limit windows are measured on the service clock, so stamp
        // createdAt from it too rather than the database's clock.
        createdAt: now,
        requestIpHash: ctx.ipHash,
        provider: this.provider.name,
      },
    });

    await this.deliver(id, mobile, code);
    await this.audit.record({
      action: AuditActions.OTP_REQUESTED,
      entityType: "otp_session",
      entityId: id,
      metadata: { mobile: maskMobile(mobile), provider: this.provider.name },
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });

    return {
      otpSessionId: id,
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: new Date(now.getTime() + this.config.OTP_RESEND_COOLDOWN_SECONDS * 1000).toISOString(),
    };
  }

  async resend(otpSessionId: string, ctx: RequestContext) {
    const now = this.clock.now();
    const session = await this.db.otpSession.findUnique({ where: { id: otpSessionId } });
    if (!session || session.status !== "PENDING") throw Errors.otpExpired();

    const cooldownEnds = session.lastSentAt.getTime() + this.config.OTP_RESEND_COOLDOWN_SECONDS * 1000;
    if (now.getTime() < cooldownEnds) {
      throw Errors.rateLimited("Please wait before requesting another code.", Math.ceil((cooldownEnds - now.getTime()) / 1000));
    }
    if (session.sendCount >= this.config.OTP_MAX_SENDS_PER_SESSION) {
      throw Errors.rateLimited("You've requested too many codes. Start again in a few minutes.", 300);
    }

    const code = this.newCode();
    const expiresAt = new Date(now.getTime() + this.config.OTP_TTL_SECONDS * 1000);
    // Conditional on sendCount so two parallel resends can't both succeed.
    const updated = await this.db.otpSession.updateMany({
      where: { id: session.id, status: "PENDING", sendCount: session.sendCount },
      data: { codeHash: this.hash(session.id, code), expiresAt, lastSentAt: now, sendCount: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw Errors.rateLimited("Please wait before requesting another code.", this.config.OTP_RESEND_COOLDOWN_SECONDS);
    }

    await this.deliver(session.id, session.mobile, code);
    await this.audit.record({
      action: AuditActions.OTP_RESENT,
      entityType: "otp_session",
      entityId: session.id,
      metadata: { mobile: maskMobile(session.mobile), sendCount: session.sendCount + 1 },
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });

    return {
      otpSessionId: session.id,
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: new Date(now.getTime() + this.config.OTP_RESEND_COOLDOWN_SECONDS * 1000).toISOString(),
    };
  }

  /** Returns the verified mobile number, or throws. A code can be used once. */
  async verify(otpSessionId: string, code: string, ctx: RequestContext): Promise<{ mobile: string }> {
    const now = this.clock.now();

    // Atomically claim one attempt. If nothing matched, the session is
    // unknown, already used, locked or out of attempts.
    const claimed = await this.db.otpSession.updateMany({
      where: { id: otpSessionId, status: "PENDING", attemptCount: { lt: this.config.OTP_MAX_VERIFY_ATTEMPTS } },
      data: { attemptCount: { increment: 1 } },
    });
    const session = await this.db.otpSession.findUnique({ where: { id: otpSessionId } });
    if (!session) throw Errors.otpExpired();
    if (claimed.count === 0) {
      if (session.status === "LOCKED" || session.attemptCount >= session.maxAttempts) throw Errors.otpLocked();
      throw Errors.otpExpired();
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.db.otpSession.updateMany({ where: { id: session.id, status: "PENDING" }, data: { status: "EXPIRED" } });
      throw Errors.otpExpired();
    }

    if (!safeEqualHex(session.codeHash, this.hash(session.id, code))) {
      const remaining = session.maxAttempts - session.attemptCount;
      if (remaining <= 0) {
        await this.db.otpSession.updateMany({ where: { id: session.id, status: "PENDING" }, data: { status: "LOCKED", lockedAt: now } });
        await this.audit.record({
          action: AuditActions.OTP_LOCKED,
          entityType: "otp_session",
          entityId: session.id,
          metadata: { mobile: maskMobile(session.mobile) },
          ipHash: ctx.ipHash,
          userAgent: ctx.userAgent,
        });
        throw Errors.otpLocked();
      }
      await this.audit.record({
        action: AuditActions.OTP_VERIFY_FAILED,
        entityType: "otp_session",
        entityId: session.id,
        metadata: { mobile: maskMobile(session.mobile), attemptsRemaining: remaining },
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent,
      });
      throw Errors.otpInvalid(remaining);
    }

    // Single use: only one concurrent verifier can flip PENDING → VERIFIED.
    const consumed = await this.db.otpSession.updateMany({
      where: { id: session.id, status: "PENDING" },
      data: { status: "VERIFIED", verifiedAt: now },
    });
    if (consumed.count !== 1) throw Errors.otpExpired();
    return { mobile: session.mobile };
  }

  private async deliver(sessionId: string, mobile: string, code: string) {
    try {
      const { providerRef } = await this.provider.send({ mobile, code, ttlSeconds: this.config.OTP_TTL_SECONDS });
      if (providerRef) await this.db.otpSession.update({ where: { id: sessionId }, data: { providerRef } });
    } catch {
      // The provider error may echo request details; don't propagate or log it verbatim.
      await this.db.otpSession.update({ where: { id: sessionId }, data: { status: "EXPIRED" } });
      throw Errors.otpDeliveryFailed();
    }
  }

  private async enforceRequestLimits(mobile: string, ctx: RequestContext, now: Date) {
    const lockoutSince = new Date(now.getTime() - this.config.OTP_LOCKOUT_MINUTES * 60_000);
    const recentLocks = await this.db.otpSession.count({
      where: { mobile, status: "LOCKED", lockedAt: { gte: lockoutSince } },
    });
    if (recentLocks >= this.config.OTP_LOCKOUT_THRESHOLD) {
      await this.rateLimitAudit(mobile, ctx, "mobile_lockout");
      throw Errors.rateLimited(
        "Too many failed sign-in attempts for this number. Try again later.",
        this.config.OTP_LOCKOUT_MINUTES * 60,
      );
    }

    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const perMobile = await this.db.otpSession.count({ where: { mobile, createdAt: { gte: hourAgo } } });
    if (perMobile >= this.config.OTP_MAX_REQUESTS_PER_MOBILE_PER_HOUR) {
      await this.rateLimitAudit(mobile, ctx, "mobile_hourly");
      throw Errors.rateLimited("Too many codes requested for this number. Try again in an hour.", 3600);
    }

    if (ctx.ipHash) {
      const perIp = await this.db.otpSession.count({ where: { requestIpHash: ctx.ipHash, createdAt: { gte: hourAgo } } });
      if (perIp >= this.config.OTP_MAX_REQUESTS_PER_IP_PER_HOUR) {
        await this.rateLimitAudit(mobile, ctx, "ip_hourly");
        throw Errors.rateLimited("Too many requests from this network. Try again later.", 3600);
      }
    }
  }

  private rateLimitAudit(mobile: string, ctx: RequestContext, reason: string) {
    return this.audit.record({
      action: AuditActions.OTP_RATE_LIMITED,
      metadata: { mobile: maskMobile(mobile), reason },
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });
  }
}
