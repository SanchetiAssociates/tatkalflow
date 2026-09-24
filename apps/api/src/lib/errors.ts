/**
 * Errors that are safe to show to users. Anything else becomes a generic 500
 * with a request ID — internal details never leave the server.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(publicMessage);
    this.name = "AppError";
  }
}

export const Errors = {
  unauthorized: (message = "Please sign in again.") => new AppError(401, "UNAUTHORIZED", message),
  forbidden: (message = "You don't have access to this.") => new AppError(403, "FORBIDDEN", message),
  notFound: (message = "Not found.") => new AppError(404, "NOT_FOUND", message),
  rateLimited: (message: string, retryAfterSeconds: number) =>
    new AppError(429, "RATE_LIMITED", message, { retryAfterSeconds }),
  otpInvalid: (attemptsRemaining: number) =>
    new AppError(400, "OTP_INVALID", "That code isn't right. Check the SMS and try again.", { attemptsRemaining }),
  otpExpired: () => new AppError(400, "OTP_EXPIRED", "This code has expired. Request a new one."),
  otpLocked: () => new AppError(429, "OTP_LOCKED", "Too many incorrect attempts. Request a new code."),
  otpDeliveryFailed: () =>
    new AppError(503, "OTP_DELIVERY_FAILED", "We couldn't send the code right now. Please try again shortly."),
  csrf: () => new AppError(403, "CSRF_REJECTED", "Request blocked for your security. Refresh the app and try again."),
  ruleNotConfigured: (key: string) =>
    new AppError(503, "RULE_NOT_CONFIGURED", "Railway rules are being updated. Please try again shortly.", { ruleKey: key }),
};
