import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { OTP_LENGTH } from "@tatkalflow/shared";

export function hmacSha256Hex(key: string, message: string): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Cryptographically random numeric OTP, zero-padded. */
export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

/** 256-bit opaque token, URL-safe. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}
