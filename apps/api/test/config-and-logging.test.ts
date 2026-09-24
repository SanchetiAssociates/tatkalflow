import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { REDACT_PATHS } from "../src/logging.js";
import { createOtpProvider } from "../src/modules/otp/otp-provider.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET: "a".repeat(40),
  OTP_HASH_PEPPER: "b".repeat(40),
  IP_HASH_PEPPER: "c".repeat(40),
};

describe("config", () => {
  it("refuses the mock OTP provider in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", OTP_PROVIDER: "mock" })).toThrow(/mock OTP provider/);
  });

  it("refuses insecure cookies and a fixed mock code in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", OTP_PROVIDER: "msg91", COOKIE_SECURE: "false" })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...base, NODE_ENV: "production", OTP_PROVIDER: "msg91", MOCK_OTP_FIXED_CODE: "123456" })).toThrow(
      /MOCK_OTP_FIXED_CODE/,
    );
  });

  it("refuses short or reused secrets", () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: "short" })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: "production", OTP_PROVIDER: "msg91", OTP_HASH_PEPPER: base.JWT_ACCESS_SECRET }),
    ).toThrow(/must all differ/);
  });

  it("never echoes secret values in the error", () => {
    try {
      loadConfig({ ...base, JWT_ACCESS_SECRET: "tiny-secret" });
    } catch (e) {
      expect(String(e)).not.toContain("tiny-secret");
    }
  });
});

describe("OTP provider registry", () => {
  it("does not silently fall back when a provider is not registered", () => {
    expect(() => createOtpProvider("msg91", {})).toThrow(/not registered/);
  });
});

describe("log redaction", () => {
  it("removes secrets from anything logged", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, sink);
    log.info({
      req: { headers: { authorization: "Bearer abc.def.ghi", cookie: "tf_rt=secret-refresh" } },
      input: { code: "482913", password: "hunter2", cvv: "123", upiPin: "4321", refreshToken: "rt-secret" },
      body: { anything: "at all" },
    });
    const out = lines.join("");
    for (const secret of ["abc.def.ghi", "secret-refresh", "482913", "hunter2", "\"123\"", "4321", "rt-secret", "at all"]) {
      expect(out).not.toContain(secret);
    }
  });
});
