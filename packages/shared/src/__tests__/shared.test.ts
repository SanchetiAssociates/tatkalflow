import { describe, expect, it } from "vitest";
import {
  maskMobile,
  mobileNumberSchema,
  railwayRuleSchema,
  redactSensitive,
  REDACTED,
  updateProfileSchema,
  upsertIrctcAccountSchema,
  verifyOtpSchema,
} from "../index.js";

describe("mobileNumberSchema", () => {
  it.each([
    ["9820012345", "+919820012345"],
    ["+91 98200 12345", "+919820012345"],
    ["09820012345", "+919820012345"],
    ["919820012345", "+919820012345"],
    ["(982) 001-2345", "+919820012345"],
  ])("normalises %s", (input, expected) => {
    expect(mobileNumberSchema.parse(input)).toBe(expected);
  });

  it.each(["12345", "5820012345", "98200123456", "abcdefghij", "", "+1 4155550100"])("rejects %s", (input) => {
    expect(mobileNumberSchema.safeParse(input).success).toBe(false);
  });
});

describe("verifyOtpSchema", () => {
  const id = "3f1c1e0e-4c1c-4e0f-9d8a-0e4b3b2a1c0d";
  it("accepts a 6-digit code", () => {
    expect(verifyOtpSchema.parse({ otpSessionId: id, code: "012345" }).code).toBe("012345");
  });
  it.each(["12345", "1234567", "12a456"])("rejects %s", (code) => {
    expect(verifyOtpSchema.safeParse({ otpSessionId: id, code }).success).toBe(false);
  });
});

describe("upsertIrctcAccountSchema", () => {
  it("accepts a user ID", () => {
    expect(upsertIrctcAccountSchema.parse({ irctcUserId: "sidd_2026" }).irctcUserId).toBe("sidd_2026");
  });
  it("refuses any password field (strict)", () => {
    expect(upsertIrctcAccountSchema.safeParse({ irctcUserId: "sidd_2026", password: "x" }).success).toBe(false);
  });
});

describe("updateProfileSchema", () => {
  it("rejects unknown timezones", () => {
    expect(updateProfileSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
  });
  it("accepts Asia/Kolkata", () => {
    expect(updateProfileSchema.parse({ timezone: "Asia/Kolkata" }).timezone).toBe("Asia/Kolkata");
  });
});

describe("railwayRuleSchema", () => {
  const base = {
    source: "Official IRCTC Tatkal rules page",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    lastVerifiedAt: null,
    status: "ACTIVE" as const,
  };
  it("validates value against the rule key", () => {
    expect(railwayRuleSchema.safeParse({ ...base, ruleKey: "tatkal.ac.opening_time", value: "10:00" }).success).toBe(true);
    expect(railwayRuleSchema.safeParse({ ...base, ruleKey: "tatkal.ac.opening_time", value: "25:00" }).success).toBe(false);
  });
  it("rejects unknown keys", () => {
    expect(railwayRuleSchema.safeParse({ ...base, ruleKey: "made.up", value: 1 }).success).toBe(false);
  });
  it("rejects effectiveTo before effectiveFrom", () => {
    expect(
      railwayRuleSchema.safeParse({ ...base, ruleKey: "tatkal.advance_days", value: 1, effectiveTo: "2025-01-01T00:00:00.000Z" }).success,
    ).toBe(false);
  });
});

describe("redaction", () => {
  it("redacts sensitive keys at any depth", () => {
    const out = redactSensitive({
      mobile: "+919820012345",
      otpSessionId: "keep-me",
      body: { code: "123456", irctcPassword: "p", nested: [{ upi_pin: "0000", cvv: "123" }] },
      headers: { authorization: "Bearer x", cookie: "rt=y" },
    });
    expect(out.otpSessionId).toBe("keep-me");
    expect(out.body.code).toBe(REDACTED);
    expect(out.body.irctcPassword).toBe(REDACTED);
    expect(out.body.nested[0]!.upi_pin).toBe(REDACTED);
    expect(out.body.nested[0]!.cvv).toBe(REDACTED);
    expect(out.headers.authorization).toBe(REDACTED);
    expect(out.headers.cookie).toBe(REDACTED);
  });
  it("masks mobile numbers", () => {
    expect(maskMobile("+919820012345")).toBe("+91******2345");
  });
});
