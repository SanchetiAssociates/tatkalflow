/**
 * Field names that must never reach logs, audit metadata or notifications.
 * Matching is case-insensitive and ignores `_`/`-`, so "upi_pin", "upiPin"
 * and "UPI-PIN" all match "upipin".
 */
const SENSITIVE_KEY_FRAGMENTS = [
  "password",
  "passwd",
  "otp",
  "code",
  "cvv",
  "cvc",
  "upipin",
  "pin",
  "cardnumber",
  "pannumber",
  "secret",
  "token",
  "authorization",
  "cookie",
  "captcha",
  "salt",
  "hash",
] as const;

// Keys that contain a fragment above but are safe identifiers, not secrets.
const SAFE_KEYS = new Set(["otpsessionid", "tokenfamilyid", "countrycode", "pincode", "stationcode", "traincode", "classcode"]);

export const REDACTED = "[REDACTED]";

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  const k = normaliseKey(key);
  if (SAFE_KEYS.has(k)) return false;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => k.includes(fragment));
}

/** Deep-copies `value`, replacing any sensitive field with a redaction marker. */
export function redactSensitive<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactSensitive(v, depth + 1);
  }
  return out as T;
}

/** "+919820012345" → "+91******2345" */
export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  const last4 = digits.slice(-4);
  return mobile.startsWith("+91") ? `+91******${last4}` : `******${last4}`;
}
