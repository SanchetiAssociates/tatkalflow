import type { FastifyInstance } from "fastify";
import { requestOtpSchema, verifyOtpSchema } from "@tatkalflow/shared";
import { z } from "zod";
import type { AppContainer } from "../../container.js";
import { AppError, Errors } from "../../lib/errors.js";
import {
  assertCsrf,
  authenticate,
  clearRefreshCookie,
  REFRESH_COOKIE,
  requestContext,
  requireAuth,
  setRefreshCookie,
} from "../../http/request-context.js";
import { AuditActions } from "../audit/audit.service.js";

const resendSchema = z.object({ otpSessionId: z.uuid() });

// Tighter per-IP limits on unauthenticated auth endpoints, on top of the
// per-mobile / per-IP limits enforced in OtpService.
const otpRouteLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
const verifyRouteLimit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

export async function authRoutes(app: FastifyInstance, c: AppContainer) {
  const { config } = c;

  app.post("/api/auth/otp/request", otpRouteLimit, async (request) => {
    const { mobile } = requestOtpSchema.parse(request.body);
    // Same response for new and existing numbers: no account enumeration.
    return c.otp.request(mobile, requestContext(request, config));
  });

  app.post("/api/auth/otp/resend", otpRouteLimit, async (request) => {
    const { otpSessionId } = resendSchema.parse(request.body);
    return c.otp.resend(otpSessionId, requestContext(request, config));
  });

  app.post("/api/auth/otp/verify", verifyRouteLimit, async (request, reply) => {
    const { otpSessionId, code } = verifyOtpSchema.parse(request.body);
    const { user, isNewUser, issued } = await c.auth.verifyAndSignIn(otpSessionId, code, requestContext(request, config));
    setRefreshCookie(reply, issued, config.COOKIE_SECURE);
    return {
      accessToken: issued.accessToken,
      accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
      user: { id: user.id, mobile: user.mobile, fullName: user.fullName, isNewUser },
    };
  });

  app.post("/api/auth/refresh", verifyRouteLimit, async (request, reply) => {
    assertCsrf(request, config.CORS_ORIGINS);
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) throw Errors.unauthorized();
    try {
      const issued = await c.tokens.rotate(token, requestContext(request, config));
      setRefreshCookie(reply, issued, config.COOKIE_SECURE);
      return { accessToken: issued.accessToken, accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString() };
    } catch (err) {
      // Clear the cookie only when the session is really gone. A 409 race
      // must leave it alone: the winning tab has just set the new one.
      if (err instanceof AppError && err.code === "REFRESH_IN_PROGRESS") throw err;
      clearRefreshCookie(reply, config.COOKIE_SECURE);
      throw err;
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    assertCsrf(request, config.CORS_ORIGINS);
    const token = request.cookies[REFRESH_COOKIE];
    const ctx = requestContext(request, config);
    if (token) {
      const userId = await c.tokens.revokeByRefreshToken(token, "logout");
      if (userId) await c.audit.record({ action: AuditActions.LOGOUT, userId, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
    }
    clearRefreshCookie(reply, config.COOKIE_SECURE);
    return reply.code(204).send();
  });

  app.post("/api/auth/logout-all", { preHandler: authenticate(c.tokens) }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const ctx = requestContext(request, config);
    await c.tokens.revokeAllForUser(userId);
    await c.audit.record({ action: AuditActions.LOGOUT_ALL, userId, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
    clearRefreshCookie(reply, config.COOKIE_SECURE);
    return reply.code(204).send();
  });
}
