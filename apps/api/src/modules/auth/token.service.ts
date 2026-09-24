import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { AppConfig } from "../../config.js";
import type { Db } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { generateOpaqueToken, sha256Hex } from "../../lib/crypto.js";
import { Errors } from "../../lib/errors.js";
import { AuditActions, type AuditService } from "../audit/audit.service.js";
import type { RequestContext } from "./otp.service.js";

const ISSUER = "tatkalflow-api";
const AUDIENCE = "tatkalflow-app";
const ROTATED = "rotated";

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  sessionId: string;
}

/**
 * Short-lived JWT access tokens (default 15 min) + opaque rotating refresh
 * tokens (default 30 days).
 *
 * Refresh tokens are stored as SHA-256 hashes. Each use rotates the token;
 * presenting an already-rotated token is treated as theft and revokes every
 * session in that token family.
 */
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly config: Pick<AppConfig, "JWT_ACCESS_SECRET" | "ACCESS_TOKEN_TTL_SECONDS" | "REFRESH_TOKEN_TTL_DAYS">,
  ) {
    this.key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  async issue(userId: string, ctx: RequestContext, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const now = this.clock.now();
    const refreshToken = generateOpaqueToken();
    const refreshTokenExpiresAt = new Date(now.getTime() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const session = await this.db.authSession.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: sha256Hex(refreshToken),
        expiresAt: refreshTokenExpiresAt,
        userAgent: ctx.userAgent?.slice(0, 512) ?? null,
        ipHash: ctx.ipHash,
      },
    });
    const { accessToken, accessTokenExpiresAt } = await this.signAccess({ userId, sessionId: session.id });
    return { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, sessionId: session.id };
  }

  private async signAccess(claims: AccessClaims) {
    const nowSec = Math.floor(this.clock.now().getTime() / 1000);
    const exp = nowSec + this.config.ACCESS_TOKEN_TTL_SECONDS;
    const accessToken = await new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(nowSec)
      .setExpirationTime(exp)
      .setJti(randomUUID())
      .sign(this.key);
    return { accessToken, accessTokenExpiresAt: new Date(exp * 1000) };
  }

  /**
   * Verifies signature/expiry, then confirms the backing session is still
   * live — so logout and theft revocation take effect immediately, not after
   * the access token expires.
   */
  async verifyAccess(token: string): Promise<AccessClaims> {
    let sub: string | undefined;
    let sid: unknown;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
        currentDate: this.clock.now(),
      });
      sub = payload.sub;
      sid = payload.sid;
    } catch {
      throw Errors.unauthorized();
    }
    if (!sub || typeof sid !== "string") throw Errors.unauthorized();

    const session = await this.db.authSession.findUnique({
      where: { id: sid },
      select: { userId: true, revokedAt: true, revokedReason: true, expiresAt: true, user: { select: { deletedAt: true } } },
    });
    const now = this.clock.now();
    // A row retired by normal rotation still backs its outstanding (≤15 min)
    // access token; a row revoked by logout or theft detection does not.
    const revoked = session?.revokedAt && session.revokedReason !== ROTATED;
    if (!session || session.userId !== sub || revoked || session.expiresAt <= now || session.user.deletedAt) {
      throw Errors.unauthorized();
    }
    return { userId: sub, sessionId: sid };
  }

  async rotate(refreshToken: string, ctx: RequestContext): Promise<IssuedTokens> {
    const now = this.clock.now();
    const session = await this.db.authSession.findUnique({
      where: { refreshTokenHash: sha256Hex(refreshToken) },
      include: { user: { select: { deletedAt: true } } },
    });
    if (!session) throw Errors.unauthorized();

    if (session.revokedReason === ROTATED) {
      // This token was already exchanged: someone is replaying it.
      await this.revokeFamily(session.familyId, "refresh_reuse");
      await this.audit.record({
        action: AuditActions.REFRESH_REUSE_DETECTED,
        userId: session.userId,
        entityType: "auth_session",
        entityId: session.id,
        metadata: { familyId: session.familyId },
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent,
      });
      throw Errors.unauthorized();
    }
    if (session.revokedAt || session.expiresAt <= now || session.user.deletedAt) throw Errors.unauthorized();

    // Claim the rotation atomically; a concurrent rotate of the same token loses.
    const claimed = await this.db.authSession.updateMany({
      where: { id: session.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: now, revokedAt: now, revokedReason: ROTATED, lastUsedAt: now },
    });
    if (claimed.count !== 1) throw Errors.unauthorized();

    const tokens = await this.issue(session.userId, ctx, session.familyId);
    await this.audit.record({
      action: AuditActions.TOKEN_REFRESHED,
      userId: session.userId,
      entityType: "auth_session",
      entityId: tokens.sessionId,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });
    return tokens;
  }

  /** Logout: revoke the whole family the current session belongs to. */
  async revokeSession(sessionId: string, reason = "logout"): Promise<void> {
    const session = await this.db.authSession.findUnique({ where: { id: sessionId }, select: { familyId: true } });
    if (session) await this.revokeFamily(session.familyId, reason);
  }

  async revokeByRefreshToken(refreshToken: string, reason = "logout"): Promise<string | null> {
    const session = await this.db.authSession.findUnique({
      where: { refreshTokenHash: sha256Hex(refreshToken) },
      select: { familyId: true, userId: true },
    });
    if (!session) return null;
    await this.revokeFamily(session.familyId, reason);
    return session.userId;
  }

  async revokeAllForUser(userId: string, reason = "logout_all"): Promise<void> {
    await this.revokeWhere({ userId }, reason);
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.revokeWhere({ familyId }, reason);
  }

  /** Revokes live rows and re-labels rotated rows so their access tokens die too. */
  private async revokeWhere(where: { userId: string } | { familyId: string }, reason: string): Promise<void> {
    const now = this.clock.now();
    await this.db.$transaction([
      this.db.authSession.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } }),
      this.db.authSession.updateMany({ where: { ...where, revokedReason: ROTATED }, data: { revokedReason: reason } }),
    ]);
  }
}
