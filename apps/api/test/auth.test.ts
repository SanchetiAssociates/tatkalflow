import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, CSRF, refreshCookieFrom, signIn, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

// Each test uses its own mobile number (and IP) so rate limits don't interfere.
let n = 0;
function nextMobile() {
  n++;
  return { mobile: `98${String(n).padStart(8, "0")}`, e164: `+9198${String(n).padStart(8, "0")}`, ip: `10.1.0.${n}` };
}

async function requestOtp(mobile: string, ip: string) {
  return h.app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { mobile }, remoteAddress: ip });
}
async function verify(otpSessionId: string, code: string, ip: string) {
  return h.app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { otpSessionId, code }, remoteAddress: ip });
}
function wrong(code: string) {
  return code === "000000" ? "111111" : "000000";
}

describe("OTP request", () => {
  it("creates a session and stores only a hash of the code", async () => {
    const { mobile, e164, ip } = nextMobile();
    const res = await requestOtp(mobile, ip);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.otpSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).not.toHaveProperty("code");

    const code = h.otp.lastCodeFor(e164)!;
    expect(code).toMatch(/^\d{6}$/);
    const row = await h.db.otpSession.findUniqueOrThrow({ where: { id: body.otpSessionId } });
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code);

    const audits = await h.db.auditLog.findMany({ where: { entityId: body.otpSessionId } });
    expect(audits.map((a) => a.action)).toContain("auth.otp_requested");
    expect(JSON.stringify(audits)).not.toContain(code);
    expect(JSON.stringify(audits)).not.toContain(e164); // masked
  });

  it("rejects invalid mobile numbers with field errors", async () => {
    const res = await requestOtp("12345", "10.9.9.9");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.fields[0].path).toBe("mobile");
  });

  it("gives the same response shape for new and existing numbers", async () => {
    const existing = nextMobile();
    await signIn(h, existing.mobile, existing.ip);
    const fresh = nextMobile();
    const a = (await requestOtp(existing.mobile, existing.ip)).json();
    const b = (await requestOtp(fresh.mobile, fresh.ip)).json();
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it("invalidates the previous code when a new one is requested", async () => {
    const { mobile, e164, ip } = nextMobile();
    const first = (await requestOtp(mobile, ip)).json();
    const firstCode = h.otp.lastCodeFor(e164)!;
    await requestOtp(mobile, ip);
    const res = await verify(first.otpSessionId, firstCode, ip);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("OTP_EXPIRED");
  });

  it("enforces the per-mobile hourly limit", async () => {
    const { mobile, ip } = nextMobile();
    for (let i = 0; i < 5; i++) expect((await requestOtp(mobile, ip)).statusCode).toBe(200);
    const blocked = await requestOtp(mobile, ip);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("3600");
    h.clock.advance(61 * 60_000);
    expect((await requestOtp(mobile, ip)).statusCode).toBe(200);
  });

  it("returns a friendly error and expires the session when delivery fails", async () => {
    const { mobile, ip } = nextMobile();
    h.otp.failNext = true;
    const res = await requestOtp(mobile, ip);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("OTP_DELIVERY_FAILED");
    const rows = await h.db.otpSession.findMany({ where: { mobile: `+91${mobile}` } });
    expect(rows.every((r) => r.status === "EXPIRED")).toBe(true);
  });
});

describe("OTP verify", () => {
  it("registers a new user, sets a secure refresh cookie and returns an access token", async () => {
    const { mobile, ip } = nextMobile();
    const out = await signIn(h, mobile, ip);
    expect(out.user.isNewUser).toBe(true);
    expect(out.accessToken.split(".")).toHaveLength(3);

    const cookie = String(out.setCookie);
    expect(cookie).toContain("tf_rt=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/auth");

    const again = await signIn(h, mobile, ip);
    expect(again.user.isNewUser).toBe(false);
    expect(again.user.id).toBe(out.user.id);
  });

  it("counts wrong attempts and locks after the limit", async () => {
    const { mobile, e164, ip } = nextMobile();
    const { otpSessionId } = (await requestOtp(mobile, ip)).json();
    const code = h.otp.lastCodeFor(e164)!;
    for (let remaining = 4; remaining >= 1; remaining--) {
      const res = await verify(otpSessionId, wrong(code), ip);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: "OTP_INVALID", attemptsRemaining: remaining });
    }
    const fifth = await verify(otpSessionId, wrong(code), ip);
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json().error.code).toBe("OTP_LOCKED");
    // The right code no longer works once locked.
    const late = await verify(otpSessionId, code, ip);
    expect(late.statusCode).toBe(429);
  });

  it("cannot exceed the attempt limit with parallel guesses", async () => {
    const { mobile, e164, ip } = nextMobile();
    const { otpSessionId } = (await requestOtp(mobile, ip)).json();
    const code = h.otp.lastCodeFor(e164)!;
    await Promise.all(Array.from({ length: 12 }, () => verify(otpSessionId, wrong(code), ip)));
    const row = await h.db.otpSession.findUniqueOrThrow({ where: { id: otpSessionId } });
    expect(row.attemptCount).toBeLessThanOrEqual(5);
    expect(row.status).toBe("LOCKED");
  });

  it("is single-use", async () => {
    const { mobile, e164, ip } = nextMobile();
    const { otpSessionId } = (await requestOtp(mobile, ip)).json();
    const code = h.otp.lastCodeFor(e164)!;
    expect((await verify(otpSessionId, code, ip)).statusCode).toBe(200);
    expect((await verify(otpSessionId, code, ip)).statusCode).toBe(400);
  });

  it("rejects expired codes", async () => {
    const { mobile, e164, ip } = nextMobile();
    const { otpSessionId } = (await requestOtp(mobile, ip)).json();
    const code = h.otp.lastCodeFor(e164)!;
    h.clock.advance(301_000);
    const res = await verify(otpSessionId, code, ip);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("OTP_EXPIRED");
  });

  it("locks the mobile number out after repeated locked sessions", async () => {
    const { mobile, e164, ip } = nextMobile();
    for (let s = 0; s < 3; s++) {
      const { otpSessionId } = (await requestOtp(mobile, ip)).json();
      const code = h.otp.lastCodeFor(e164)!;
      for (let i = 0; i < 5; i++) await verify(otpSessionId, wrong(code), ip);
    }
    const res = await requestOtp(mobile, ip);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.message).toMatch(/failed sign-in attempts/);
  });
});

describe("OTP resend", () => {
  it("throttles resends, rotates the code, and caps sends per session", async () => {
    const { mobile, e164, ip } = nextMobile();
    const { otpSessionId } = (await requestOtp(mobile, ip)).json();
    const firstCode = h.otp.lastCodeFor(e164)!;

    const tooSoon = await h.app.inject({ method: "POST", url: "/api/auth/otp/resend", payload: { otpSessionId }, remoteAddress: ip });
    expect(tooSoon.statusCode).toBe(429);
    expect(Number(tooSoon.headers["retry-after"])).toBeGreaterThan(0);

    h.clock.advance(31_000);
    const ok = await h.app.inject({ method: "POST", url: "/api/auth/otp/resend", payload: { otpSessionId }, remoteAddress: ip });
    expect(ok.statusCode).toBe(200);
    const secondCode = h.otp.lastCodeFor(e164)!;

    h.clock.advance(31_000);
    expect((await h.app.inject({ method: "POST", url: "/api/auth/otp/resend", payload: { otpSessionId }, remoteAddress: ip })).statusCode).toBe(200);
    h.clock.advance(31_000);
    const capped = await h.app.inject({ method: "POST", url: "/api/auth/otp/resend", payload: { otpSessionId }, remoteAddress: ip });
    expect(capped.statusCode).toBe(429);

    const thirdCode = h.otp.lastCodeFor(e164)!;
    if (firstCode !== thirdCode) expect((await verify(otpSessionId, firstCode, ip)).statusCode).toBe(400);
    if (secondCode !== thirdCode) expect((await verify(otpSessionId, secondCode, ip)).statusCode).toBe(400);
    expect((await verify(otpSessionId, thirdCode, ip)).statusCode).toBe(200);
  });
});

describe("sessions", () => {
  it("authenticates API calls with the access token and expires it", async () => {
    const { mobile, ip } = nextMobile();
    const { accessToken } = await signIn(h, mobile, ip);
    const me = await h.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().mobile).toBe(`+91${mobile}`);

    h.clock.advance(16 * 60_000);
    const expired = await h.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${accessToken}` } });
    expect(expired.statusCode).toBe(401);
  });

  it("rejects missing, malformed and forged tokens", async () => {
    expect((await h.app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "GET", url: "/api/me", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    const { accessToken } = await signIn(h, nextMobile().mobile);
    const [header, payload] = accessToken.split(".");
    const forged = `${header}.${payload}.${"A".repeat(43)}`;
    expect((await h.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${forged}` } })).statusCode).toBe(401);
  });

  it("requires the CSRF header and an allowed origin to refresh", async () => {
    const { refreshToken } = await signIn(h, nextMobile().mobile);
    const cookies = { tf_rt: refreshToken };
    expect((await h.app.inject({ method: "POST", url: "/api/auth/refresh", cookies })).statusCode).toBe(403);
    expect(
      (await h.app.inject({ method: "POST", url: "/api/auth/refresh", cookies, headers: { ...CSRF, origin: "https://evil.example" } })).statusCode,
    ).toBe(403);
    expect((await h.app.inject({ method: "POST", url: "/api/auth/refresh", cookies, headers: CSRF })).statusCode).toBe(200);
  });

  it("rotates refresh tokens and revokes the family when an old token is replayed", async () => {
    const { refreshToken: rt1 } = await signIn(h, nextMobile().mobile);
    const r2 = await h.app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { tf_rt: rt1 }, headers: CSRF });
    expect(r2.statusCode).toBe(200);
    const rt2 = refreshCookieFrom(r2)!;
    const at2 = r2.json().accessToken;
    expect(rt2).not.toBe(rt1);

    // Attacker replays the old token after the tab-race grace window → everything in the family dies.
    h.clock.advance(11_000);
    const replay = await h.app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { tf_rt: rt1 }, headers: CSRF });
    expect(replay.statusCode).toBe(401);
    expect((await h.app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { tf_rt: rt2 }, headers: CSRF })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${at2}` } })).statusCode).toBe(401);

    const audit = await h.db.auditLog.findFirst({ where: { action: "auth.refresh_reuse_detected" } });
    expect(audit).not.toBeNull();
  });

  it("logout revokes the session immediately", async () => {
    const { accessToken, refreshToken } = await signIn(h, nextMobile().mobile);
    const out = await h.app.inject({ method: "POST", url: "/api/auth/logout", cookies: { tf_rt: refreshToken }, headers: CSRF });
    expect(out.statusCode).toBe(204);
    expect((await h.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${accessToken}` } })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { tf_rt: refreshToken }, headers: CSRF })).statusCode).toBe(401);
  });

  it("logout-all revokes every device", async () => {
    const { mobile } = nextMobile();
    const a = await signIn(h, mobile);
    const b = await signIn(h, mobile);
    const res = await h.app.inject({ method: "POST", url: "/api/auth/logout-all", headers: { authorization: `Bearer ${a.accessToken}` } });
    expect(res.statusCode).toBe(204);
    expect((await h.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${b.accessToken}` } })).statusCode).toBe(401);
  });

  it("stores refresh tokens only as hashes", async () => {
    const { refreshToken, user } = await signIn(h, nextMobile().mobile);
    const rows = await h.db.authSession.findMany({ where: { userId: user.id } });
    expect(JSON.stringify(rows)).not.toContain(refreshToken);
  });
});
