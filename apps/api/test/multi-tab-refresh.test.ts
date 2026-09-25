import { InMemoryLock, SessionExpiredError, SessionManager } from "@tatkalflow/shared/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SimBrowser } from "./browser-sim.js";
import { createHarness, CSRF, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

let n = 0;
const nextMobile = () => `97${String(++n).padStart(8, "0")}`;
const ACCESS_TTL_MS = 15 * 60_000;

async function familyOf(userId: string) {
  return h.db.authSession.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
}
async function reuseAudits(userId: string) {
  return h.db.auditLog.count({ where: { userId, action: "auth.refresh_reuse_detected" } });
}

describe("multi-tab refresh (shared lock + broadcast)", () => {
  it("two tabs refreshing at the same moment make one network refresh and share the result", async () => {
    const browser = new SimBrowser(h);
    const tab1 = browser.tab();
    const tab2 = browser.tab();
    const { user } = await browser.signIn(tab1, nextMobile());
    await Promise.resolve(); // let the sign-in broadcast reach tab2
    expect(tab2.getState().status).toBe("authenticated");

    h.clock.advance(ACCESS_TTL_MS + 1000); // access token expired in both tabs
    const [t1, t2] = await Promise.all([tab1.getAccessToken(), tab2.getAccessToken()]);

    expect(t1).toBeTruthy();
    expect(t2).toBe(t1);
    expect(tab1.refreshCalls + tab2.refreshCalls).toBe(1);
    expect(browser.refreshStatuses).toEqual([200]);
    expect(await reuseAudits(user.id)).toBe(0);
    const live = (await familyOf(user.id)).filter((s) => !s.revokedAt);
    expect(live).toHaveLength(1);
  });

  it("simultaneous API requests after access-token expiry trigger a single refresh", async () => {
    const browser = new SimBrowser(h);
    const tab1 = browser.tab();
    const tab2 = browser.tab();
    await browser.signIn(tab1, nextMobile());
    await Promise.resolve();

    h.clock.advance(ACCESS_TTL_MS + 1000);
    const results = await Promise.all([
      tab1.request("/api/me"),
      tab1.request("/api/me/irctc-account"),
      tab1.request("/api/me"),
      tab2.request("/api/me"),
      tab2.request("/api/me"),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(browser.refreshStatuses).toEqual([200]);
  });

  it("a device clock running slow (server says 401) refreshes once and retries", async () => {
    const browser = new SimBrowser(h);
    // Device clock 20 minutes behind the server: it believes an expired token is fresh.
    const tab = new SessionManager({
      fetch: browser.fetch,
      lock: browser.lock,
      now: () => h.clock.now().getTime() - 20 * 60_000,
      sleep: async () => {},
    });
    await browser.signIn(tab, nextMobile());
    h.clock.advance(ACCESS_TTL_MS + 1000);
    const res = await tab.request("/api/me");
    expect(res.status).toBe(200);
    expect(browser.refreshStatuses).toEqual([200]);
  });

  it("without Web Locks, the server's race handling keeps both tabs signed in (409, never tokens)", async () => {
    const browser = new SimBrowser(h);
    // Each tab gets its own lock: simulates a browser with no navigator.locks.
    const tab1 = browser.tab({ lock: new InMemoryLock() });
    const tab2 = browser.tab({ lock: new InMemoryLock() });
    const { user } = await browser.signIn(tab1, nextMobile());
    await Promise.resolve();

    h.clock.advance(ACCESS_TTL_MS + 1000);
    const [t1, t2] = await Promise.all([tab1.getAccessToken(), tab2.getAccessToken()]);
    expect(t1).toBeTruthy();
    expect(t2).toBeTruthy();
    expect(browser.refreshStatuses).toContain(200);
    expect(browser.refreshStatuses.filter((s) => s === 401)).toEqual([]);
    expect(await reuseAudits(user.id)).toBe(0);
    // Both tabs can use the API.
    expect((await tab1.request("/api/me")).status).toBe(200);
    expect((await tab2.request("/api/me")).status).toBe(200);
  });
});

describe("theft detection is unchanged", () => {
  it("a stolen, already-rotated token replayed from another device revokes the family", async () => {
    const victim = new SimBrowser(h, "203.0.113.20", "Victim/1.0");
    const tab = victim.tab();
    const { user } = await victim.signIn(tab, nextMobile());
    const stolen = victim.cookies.get("tf_rt")!;

    h.clock.advance(ACCESS_TTL_MS + 1000);
    await tab.getAccessToken(); // victim rotates; stolen token is now stale

    // Attacker replays immediately (inside the grace window) from elsewhere.
    const attack = await h.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { tf_rt: stolen },
      headers: { ...CSRF, "user-agent": "Attacker/9.9" },
      remoteAddress: "198.51.100.66",
    });
    expect(attack.statusCode).toBe(401);
    expect(attack.json().accessToken).toBeUndefined();
    expect(await reuseAudits(user.id)).toBe(1);
    expect((await familyOf(user.id)).every((s) => s.revokedAt && s.revokedReason === "refresh_reuse")).toBe(true);

    // The victim is signed out everywhere and must sign in again.
    h.clock.advance(ACCESS_TTL_MS + 1000);
    await expect(tab.request("/api/me")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(tab.getState().status).toBe("anonymous");
  });

  it("a replay from the same device after the grace window is still treated as theft", async () => {
    const browser = new SimBrowser(h);
    const tab = browser.tab();
    const { user } = await browser.signIn(tab, nextMobile());
    const old = browser.cookies.get("tf_rt")!;
    h.clock.advance(ACCESS_TTL_MS + 1000);
    await tab.getAccessToken();
    h.clock.advance(11_000);
    const replay = await h.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { tf_rt: old },
      headers: { ...CSRF, "user-agent": browser.userAgent },
      remoteAddress: browser.ip,
    });
    expect(replay.statusCode).toBe(401);
    expect(await reuseAudits(user.id)).toBe(1);
  });

  it("the grace window never returns tokens, even for the same device", async () => {
    const browser = new SimBrowser(h);
    const tab = browser.tab();
    const { user } = await browser.signIn(tab, nextMobile());
    const old = browser.cookies.get("tf_rt")!;
    h.clock.advance(ACCESS_TTL_MS + 1000);
    await tab.getAccessToken();
    const race = await h.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { tf_rt: old },
      headers: { ...CSRF, "user-agent": browser.userAgent },
      remoteAddress: browser.ip,
    });
    expect(race.statusCode).toBe(409);
    expect(race.json().error.code).toBe("REFRESH_IN_PROGRESS");
    expect(race.json().accessToken).toBeUndefined();
    // No new token, and crucially no Set-Cookie at all: clearing it would
    // wipe the fresh cookie the winning tab just received.
    expect(race.cookies.find((c) => c.name === "tf_rt")).toBeUndefined();
    expect(race.headers["set-cookie"]).toBeUndefined();
    expect(await reuseAudits(user.id)).toBe(0);
  });
});

describe("logout and expiry", () => {
  it("logout during a refresh in another tab ends signed out everywhere", async () => {
    const browser = new SimBrowser(h);
    const tab1 = browser.tab();
    const tab2 = browser.tab();
    const { user } = await browser.signIn(tab1, nextMobile());
    await Promise.resolve();

    h.clock.advance(ACCESS_TTL_MS + 1000);
    await Promise.all([tab1.getAccessToken(), tab2.logout()]);
    await Promise.resolve();

    expect(tab1.getState().status).toBe("anonymous");
    expect(tab2.getState().status).toBe("anonymous");
    expect(browser.cookies.has("tf_rt")).toBe(false);
    expect((await familyOf(user.id)).every((s) => s.revokedAt)).toBe(true);
    await expect(tab1.request("/api/me")).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("logout that lands before a racing refresh (no shared lock) wins: the refresh is refused", async () => {
    const browser = new SimBrowser(h);
    const tab = browser.tab();
    const { user } = await browser.signIn(tab, nextMobile());
    const rt = browser.cookies.get("tf_rt")!;
    const [logout, refresh] = await Promise.all([
      h.app.inject({ method: "POST", url: "/api/auth/logout", cookies: { tf_rt: rt }, headers: { ...CSRF, "user-agent": browser.userAgent }, remoteAddress: browser.ip }),
      h.app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { tf_rt: rt }, headers: { ...CSRF, "user-agent": browser.userAgent }, remoteAddress: browser.ip }),
    ]);
    expect(logout.statusCode).toBe(204);
    // Either order is possible; in both the family ends fully revoked.
    expect([200, 401, 409]).toContain(refresh.statusCode);
    const family = await familyOf(user.id);
    expect(family.every((s) => s.revokedAt && s.revokedReason === "logout")).toBe(true);
  });

  it("an expired refresh token signs the tab out and clears the cookie", async () => {
    const browser = new SimBrowser(h);
    const tab = browser.tab();
    await browser.signIn(tab, nextMobile());
    h.clock.advance(31 * 86_400_000);
    expect(await tab.getAccessToken()).toBeNull();
    expect(tab.getState().status).toBe("anonymous");
    expect(browser.refreshStatuses).toEqual([401]);
    expect(browser.cookies.has("tf_rt")).toBe(false);
  });
});
