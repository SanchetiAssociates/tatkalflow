import type { FastifyServerOptions } from "fastify";
import type { AppConfig } from "./config.js";

/**
 * Logs never contain request/response bodies, credentials, OTPs, cookies or
 * raw IP addresses. Request logs are limited to method, route and status.
 * The paths below are a second line of defence for anything logged ad hoc.
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.password",
  "*.irctcPassword",
  "*.otp",
  "*.code",
  "*.codeHash",
  "*.cvv",
  "*.upiPin",
  "*.pin",
  "*.accessToken",
  "*.refreshToken",
  "*.token",
  "body",
  "*.body",
];

export function loggerOptions(config: Pick<AppConfig, "LOG_LEVEL" | "NODE_ENV">): FastifyServerOptions["logger"] {
  return {
    level: config.NODE_ENV === "test" ? "silent" : config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    serializers: {
      req(req: { method: string; routeOptions?: { url?: string }; url: string; id: string }) {
        // The route pattern, not the raw URL, so path/query values aren't logged.
        return { id: req.id, method: req.method, route: req.routeOptions?.url ?? "unmatched" };
      },
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
    },
  };
}
