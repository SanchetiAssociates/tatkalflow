import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseStationFile } from "../src/modules/stations/station-parsers.js";
import { createHarness, CSRF, signIn, type Harness } from "./harness.js";

const logLines: string[] = [];
let h: Harness;
let alice: { auth: { authorization: string }; refreshToken: string; accessToken: string; userId: string };
let bob: { auth: { authorization: string }; userId: string };
let alicePassenger: string;
let aliceJourney: string;

beforeAll(async () => {
  h = await createHarness({}, { logStream: { write: (l) => void logLines.push(l) } });
  const fixture = parseStationFile(readFileSync(join(import.meta.dirname, "fixtures", "stations.test-only.csv"), "utf8"), "csv");
  await h.c.stations.importDataset(fixture, { version: "t1", source: "test fixture" }, { allowSmall: true });
  const a = await signIn(h, "9811111111", "10.20.30.40");
  const b = await signIn(h, "9822222222", "10.20.30.41");
  alice = { auth: { authorization: `Bearer ${a.accessToken}` }, refreshToken: a.refreshToken, accessToken: a.accessToken, userId: a.user.id };
  bob = { auth: { authorization: `Bearer ${b.accessToken}` }, userId: b.user.id };
  alicePassenger = (await h.app.inject({ method: "POST", url: "/api/passengers", headers: alice.auth, payload: { name: "Alice Private", age: 41, gender: "FEMALE" } })).json().id;
  aliceJourney = (
    await h.app.inject({
      method: "POST",
      url: "/api/journeys",
      headers: alice.auth,
      payload: { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [alicePassenger] },
    })
  ).json().journey.id;
});
afterAll(async () => {
  await h?.close();
});

describe("authorization boundaries (ID manipulation)", () => {
  it("Bob cannot read, edit or delete Alice's passenger — indistinguishable from not found", async () => {
    const get = await h.app.inject({ method: "GET", url: `/api/passengers/${alicePassenger}`, headers: bob.auth });
    const random = await h.app.inject({ method: "GET", url: `/api/passengers/00000000-0000-4000-8000-000000000000`, headers: bob.auth });
    expect(get.statusCode).toBe(404);
    expect(get.json().error.code).toBe(random.json().error.code);
    expect((await h.app.inject({ method: "PATCH", url: `/api/passengers/${alicePassenger}`, headers: bob.auth, payload: { age: 1 } })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "DELETE", url: `/api/passengers/${alicePassenger}`, headers: bob.auth })).statusCode).toBe(404);
    const row = await h.db.passenger.findUniqueOrThrow({ where: { id: alicePassenger } });
    expect(row).toMatchObject({ age: 41, deletedAt: null });
  });

  it("Bob's lists never include Alice's data", async () => {
    expect((await h.app.inject({ method: "GET", url: "/api/passengers", headers: bob.auth })).json()).toEqual([]);
    expect((await h.app.inject({ method: "GET", url: "/api/journeys", headers: bob.auth })).json()).toEqual([]);
  });

  it("Bob cannot attach Alice's passenger to his journey", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/journeys",
      headers: bob.auth,
      payload: { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [alicePassenger] },
    });
    expect(res.statusCode).toBe(404);
    expect(await h.db.journey.count({ where: { userId: bob.userId } })).toBe(0);
  });

  it("Bob cannot read or delete Alice's journey", async () => {
    expect((await h.app.inject({ method: "GET", url: `/api/journeys/${aliceJourney}`, headers: bob.auth })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "DELETE", url: `/api/journeys/${aliceJourney}`, headers: bob.auth })).statusCode).toBe(404);
    expect((await h.db.journey.findUniqueOrThrow({ where: { id: aliceJourney } })).deletedAt).toBeNull();
  });

  it("cannot reassign ownership through the body", async () => {
    const res = await h.app.inject({ method: "POST", url: "/api/passengers", headers: bob.auth, payload: { name: "Sneaky", age: 30, gender: "MALE", userId: alice.userId } });
    expect(res.statusCode).toBe(400);
    const patch = await h.app.inject({ method: "PATCH", url: `/api/passengers/${alicePassenger}`, headers: alice.auth, payload: { userId: bob.userId } });
    expect(patch.statusCode).toBe(400);
  });

  it("malformed IDs are 404, not 500", async () => {
    for (const bad of ["not-a-uuid", "1%20OR%201=1", "%27%3B--"]) {
      expect((await h.app.inject({ method: "GET", url: `/api/passengers/${bad}`, headers: alice.auth })).statusCode).toBe(404);
    }
  });
});

describe("protected routes", () => {
  const routes: Array<[string, string]> = [
    ["GET", "/api/me"],
    ["GET", "/api/passengers"],
    ["POST", "/api/passengers"],
    ["GET", "/api/journeys"],
    ["POST", "/api/journeys"],
    ["GET", "/api/stations/search?q=delhi"],
    ["GET", "/api/stations/mine"],
    ["PUT", "/api/stations/favourites/NDLS"],
    ["GET", "/api/rules/active"],
  ];
  it.each(routes)("%s %s requires a bearer token", async (method, url) => {
    expect((await h.app.inject({ method: method as "GET", url })).statusCode).toBe(401);
  });

  it("the refresh cookie alone cannot call the API (no ambient authority → no CSRF on data routes)", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/passengers",
      cookies: { tf_rt: alice.refreshToken },
      headers: CSRF,
      payload: { name: "Forged", age: 30, gender: "MALE" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("CORS preflight from an unknown origin is not granted", async () => {
    const res = await h.app.inject({
      method: "OPTIONS",
      url: "/api/passengers",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    const ok = await h.app.inject({
      method: "OPTIONS",
      url: "/api/passengers",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("refresh/logout still require the CSRF header", async () => {
    expect((await h.app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { tf_rt: alice.refreshToken } })).statusCode).toBe(403);
    expect((await h.app.inject({ method: "POST", url: "/api/auth/logout", cookies: { tf_rt: alice.refreshToken } })).statusCode).toBe(403);
  });
});

describe("XSS-safe data handling", () => {
  it("rejects markup in passenger names and never serves HTML", async () => {
    for (const name of ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "javascript:alert(1)"]) {
      const res = await h.app.inject({ method: "POST", url: "/api/passengers", headers: alice.auth, payload: { name, age: 30, gender: "MALE" } });
      expect(res.statusCode).toBe(400);
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
      expect(res.body).not.toContain("<script>");
    }
  });

  it("error messages don't reflect user input", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/stations/search?q=" + encodeURIComponent("<svg onload=alert(1)>".repeat(5)), headers: alice.auth });
    expect(res.body).not.toContain("<svg");
  });

  it("responses carry nosniff and a deny-all CSP", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/passengers", headers: alice.auth });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });
});

describe("audit log and redaction", () => {
  it("records security-relevant events for both users", async () => {
    const actions = (await h.db.auditLog.findMany({ where: { userId: alice.userId }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["user.created", "auth.login_succeeded", "passenger.created", "journey.created"]));
  });

  it("audit metadata passes through redaction", async () => {
    await h.c.audit.record({ action: "user.profile_updated", userId: alice.userId, metadata: { fields: ["x"], password: "hunter2", nested: { otp: "123456", upiPin: "0000" } } });
    const row = await h.db.auditLog.findFirstOrThrow({ where: { userId: alice.userId, action: "user.profile_updated" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(row.metadata)).not.toMatch(/hunter2|123456|0000/);
  });

  it("real request logs contain no tokens, OTPs, cookies, names, mobile numbers or IPs", async () => {
    // Trigger some traffic including a failed OTP, a refresh and validation errors.
    await h.app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { mobile: "9833333333" }, remoteAddress: "10.99.99.99" });
    await h.app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { tf_rt: alice.refreshToken }, headers: CSRF });
    await h.app.inject({ method: "POST", url: "/api/passengers", headers: alice.auth, payload: { name: "Loggable Name", age: 30, gender: "MALE", password: "hunter2" } });

    const out = logLines.join("");
    expect(out.length).toBeGreaterThan(0);
    const code = h.otp.lastCodeFor("+919833333333")!;
    for (const secret of [alice.accessToken, alice.refreshToken, code, "hunter2", "Alice Private", "Loggable Name", "9811111111", "9833333333", "10.20.30.40", "10.99.99.99"]) {
      expect(out).not.toContain(secret);
    }
  });
});
