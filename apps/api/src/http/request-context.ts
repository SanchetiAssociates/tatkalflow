import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { hmacSha256Hex } from "../lib/crypto.js";
import { Errors } from "../lib/errors.js";
import type { RequestContext } from "../modules/auth/otp.service.js";
import type { IssuedTokens, TokenService } from "../modules/auth/token.service.js";

export const REFRESH_COOKIE = "tf_rt";
export const REFRESH_COOKIE_PATH = "/api/auth";
/** Custom header required on cookie-authenticated requests (CSRF defence). */
export const CSRF_HEADER = "x-tatkalflow-csrf";

declare module "fastify" {
  interface FastifyRequest {
    auth?: { userId: string; sessionId: string };
  }
}

export function requestContext(request: FastifyRequest, config: Pick<AppConfig, "IP_HASH_PEPPER">): RequestContext {
  const ua = request.headers["user-agent"];
  return {
    // IPs are only ever stored as a keyed hash.
    ipHash: request.ip ? hmacSha256Hex(config.IP_HASH_PEPPER, request.ip) : null,
    userAgent: typeof ua === "string" ? ua : null,
  };
}

/**
 * Cookie-authenticated endpoints (refresh, logout) accept requests only when
 * they carry our custom header and, if an Origin is sent, it is allow-listed.
 * Browsers cannot attach a custom header cross-site without a CORS preflight,
 * which our CORS policy rejects. SameSite=Strict on the cookie is a second layer.
 */
export function assertCsrf(request: FastifyRequest, allowedOrigins: string[]): void {
  if (request.headers[CSRF_HEADER] !== "1") throw Errors.csrf();
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) throw Errors.csrf();
}

export function setRefreshCookie(reply: FastifyReply, tokens: IssuedTokens, secure: boolean): void {
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    expires: tokens.refreshTokenExpiresAt,
  });
}

export function clearRefreshCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure, sameSite: "strict", path: REFRESH_COOKIE_PATH });
}

export function authenticate(tokens: TokenService) {
  return async function authenticateHook(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw Errors.unauthorized();
    request.auth = await tokens.verifyAccess(header.slice("Bearer ".length).trim());
  };
}

export function requireAuth(request: FastifyRequest): { userId: string; sessionId: string } {
  if (!request.auth) throw Errors.unauthorized();
  return request.auth;
}
