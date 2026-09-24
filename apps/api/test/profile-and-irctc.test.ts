import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, signIn, type Harness } from "./harness.js";

let h: Harness;
let auth: { authorization: string };
let userId: string;

beforeAll(async () => {
  h = await createHarness();
  const s = await signIn(h, "9876543210");
  auth = { authorization: `Bearer ${s.accessToken}` };
  userId = s.user.id;
});
afterAll(async () => {
  await h?.close();
});

describe("profile", () => {
  it("defaults to Asia/Kolkata and returns no internal fields", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/me", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timezone).toBe("Asia/Kolkata");
    expect(body.notificationPreferences).toEqual({ push: true, email: false, sms: false });
    expect(body).not.toHaveProperty("role");
    expect(body).not.toHaveProperty("deletedAt");
  });

  it("updates allowed fields and audits field names only", async () => {
    const res = await h.app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: auth,
      payload: { fullName: "Siddharth", email: "sidd@example.com", preferredLanguage: "hi" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fullName: "Siddharth", email: "sidd@example.com", preferredLanguage: "hi" });

    const audit = await h.db.auditLog.findFirstOrThrow({ where: { userId, action: "user.profile_updated" } });
    expect(audit.metadata).toEqual({ fields: ["fullName", "email", "preferredLanguage"] });
  });

  it("rejects unknown or privileged fields", async () => {
    const res = await h.app.inject({ method: "PATCH", url: "/api/me", headers: auth, payload: { role: "ADMIN" } });
    expect(res.statusCode).toBe(400);
    const user = await h.db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.role).toBe("USER");
  });
});

describe("IRCTC account (user ID only)", () => {
  it("has no password column in the database", async () => {
    const cols = await h.pglite.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'irctc_accounts'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toContain("irctc_user_id");
    expect(names.some((n) => /pass|secret|pwd|credential/i.test(n))).toBe(false);
  });

  it("no table anywhere has a payment-secret or password column", async () => {
    const cols = await h.pglite.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const bad = cols.rows.filter((r) => /password|passwd|cvv|cvc|upi_?pin|card_number/i.test(r.column_name));
    expect(bad).toEqual([]);
  });

  it("refuses a password in the request", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/me/irctc-account",
      headers: auth,
      payload: { irctcUserId: "sidd_2026", password: "hunter2" },
    });
    expect(res.statusCode).toBe(400);
    expect(await h.db.irctcAccount.count({ where: { userId } })).toBe(0);
  });

  it("links, reads and removes the user ID", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/me/irctc-account",
      headers: auth,
      payload: { irctcUserId: "sidd_2026", keepSignedInPreference: true },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ linked: true, irctcUserId: "sidd_2026", keepSignedInPreference: true, signInMode: "manual" });

    const get = await h.app.inject({ method: "GET", url: "/api/me/irctc-account", headers: auth });
    expect(get.json()).toMatchObject({ linked: true, irctcUserId: "sidd_2026", signInMode: "manual" });
    expect(get.json().notice).toMatch(/never stores your IRCTC password/);

    expect((await h.app.inject({ method: "DELETE", url: "/api/me/irctc-account", headers: auth })).statusCode).toBe(204);
    expect((await h.app.inject({ method: "GET", url: "/api/me/irctc-account", headers: auth })).json().linked).toBe(false);

    const actions = (await h.db.auditLog.findMany({ where: { userId }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["irctc.account_linked", "irctc.account_removed"]));
  });
});

describe("system endpoints", () => {
  it("reports health and server time", async () => {
    expect((await h.app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ status: "ok" });
    const time = (await h.app.inject({ method: "GET", url: "/api/time" })).json();
    expect(time.epochMs).toBe(h.clock.now().getTime());
    expect(time.timezone).toBe("Asia/Kolkata");
  });

  it("sets security headers and never caches API responses", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["strict-transport-security"]).toContain("max-age=31536000");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns a generic 404 without internals", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not expose raw IP addresses in stored records", async () => {
    const sessions = await h.db.authSession.findMany();
    const audits = await h.db.auditLog.findMany();
    const blob = JSON.stringify([sessions, audits]);
    expect(blob).not.toContain("127.0.0.1");
    expect(blob).not.toContain("10.0.0.1");
  });
});
