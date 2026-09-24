import { maskMobile } from "@tatkalflow/shared";
import type { Db } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { AuditActions, type AuditService } from "../audit/audit.service.js";
import type { OtpService, RequestContext } from "./otp.service.js";
import type { TokenService } from "./token.service.js";

/** Mobile + OTP sign-in. The same flow registers new users and signs in existing ones. */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async verifyAndSignIn(otpSessionId: string, code: string, ctx: RequestContext) {
    const { mobile } = await this.otp.verify(otpSessionId, code, ctx);
    const now = this.clock.now();

    const existing = await this.db.user.findUnique({ where: { mobile } });
    const isNewUser = !existing;
    const user = existing
      ? await this.db.user.update({ where: { id: existing.id }, data: { lastLoginAt: now, mobileVerifiedAt: existing.mobileVerifiedAt ?? now } })
      : await this.db.user.create({ data: { mobile, mobileVerifiedAt: now, lastLoginAt: now } });

    if (isNewUser) {
      await this.audit.record({
        action: AuditActions.USER_CREATED,
        userId: user.id,
        entityType: "user",
        entityId: user.id,
        metadata: { mobile: maskMobile(mobile) },
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent,
      });
    }

    const issued = await this.tokens.issue(user.id, ctx);
    await this.audit.record({
      action: AuditActions.LOGIN_SUCCEEDED,
      userId: user.id,
      entityType: "auth_session",
      entityId: issued.sessionId,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });

    return { user, isNewUser, issued };
  }
}
