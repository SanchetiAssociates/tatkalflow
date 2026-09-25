import type { RailwayRuleInput } from "@tatkalflow/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRulesRegistry } from "../src/modules/rules/registry.js";
import { parseStationFile } from "../src/modules/stations/station-parsers.js";
import { createHarness, signIn, type Harness } from "./harness.js";

/**
 * Phase 4 rule-driven behaviour. The shipped registry carries the verified
 * Tatkal passenger limit (4) and "no senior-citizen concession on Tatkal".
 * Rules it doesn't carry (name length, the General limit) are added here
 * through the normal registry sync, exactly as a registry change would.
 * Those added values are test inputs, not claims about current railway rules.
 */

let h: Harness;
let auth: { authorization: string };
const pax: string[] = [];
const EVIDENCE = { sourceUrl: "https://www.irctc.co.in/example-official-rule-page", lastVerifiedAt: "2026-09-20T00:00:00.000Z", verifiedBy: "ops@tatkalflow (test)" };
const FROM = "2026-01-01T00:00:00.000Z";

const rule = (ruleKey: RailwayRuleInput["ruleKey"], value: unknown, verified: boolean): RailwayRuleInput => ({
  ruleKey,
  value,
  source: "Phase 4 test input",
  effectiveFrom: FROM,
  effectiveTo: null,
  status: "ACTIVE",
  notes: null,
  ...(verified ? { verificationStatus: "VERIFIED", ...EVIDENCE } : { verificationStatus: "UNVERIFIED", sourceUrl: null, lastVerifiedAt: null, verifiedBy: null }),
});
/** Mark a shipped registry entry as verified (values are unchanged). */
const verifyShipped = (key: string): RailwayRuleInput => ({ ...loadRulesRegistry().find((r) => r.ruleKey === key)!, verificationStatus: "VERIFIED", ...EVIDENCE });

const post = (url: string, payload: unknown) => h.app.inject({ method: "POST", url, headers: auth, payload: payload as object });
const get = (url: string) => h.app.inject({ method: "GET", url, headers: auth });
const journey = (passengerIds: string[], extra: object = {}) =>
  post("/api/journeys", { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds, trains: ["90101"], ...extra });
const item = (r: { items: Array<{ key: string }> }, key: string) => r.items.find((i) => i.key === key) as { status: string; detail?: string } | undefined;

beforeAll(async () => {
  h = await createHarness();
  const fixture = parseStationFile(readFileSync(join(import.meta.dirname, "fixtures", "stations.test-only.csv"), "utf8"), "csv");
  await h.c.stations.importDataset(fixture, { version: "t1", source: "test fixture" }, { allowSmall: true });
  auth = { authorization: `Bearer ${(await signIn(h, "9000000501")).accessToken}` };
  for (const [name, age, senior] of [
    ["Meera", 62, true],
    ["Dev", 30, false],
    ["Asha", 28, false],
    ["Ravi", 35, false],
    ["Siddharth Sancheti", 39, false], // 18 characters
  ] as const) {
    pax.push((await post("/api/passengers", { name, age, gender: "FEMALE", seniorCitizenOptIn: senior })).json().id);
  }
});
afterAll(async () => {
  await h?.close();
});

describe("with the shipped registry", () => {
  it("uses the verified limit, and warns about the missing name-length rule instead of inventing one", async () => {
    const res = await journey(pax.slice(0, 4));
    expect(res.statusCode).toBe(201);
    const { readiness } = res.json().journey;
    expect(item(readiness, "passenger_count")).toMatchObject({ status: "PASS", detail: "4 of at most 4." });
    expect(item(readiness, "passenger_names")).toMatchObject({ status: "WARN" });
    expect(item(readiness, "passenger_names")?.detail).toMatch(/not configured/);
    const rulesDetail = item(readiness, "rules_verified")?.detail ?? "";
    expect(rulesDetail).toMatch(/Passenger name length \(not configured\)/);
    expect(rulesDetail).not.toMatch(/Tatkal passengers per booking/); // verified: not a gap
    expect(readiness.overall).not.toBe("READY");
  });
});

describe("passenger limit", () => {
  beforeAll(async () => {
    // The Tatkal limit comes from the shipped registry; only the General limit is a test input.
    await h.c.rules.syncFromRegistry([rule("general.max_passengers_per_pnr", 6, false)]);
  });

  it("enforces the verified Tatkal limit on create, add and replace", async () => {
    const res = await journey(pax);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: "TOO_MANY_PASSENGERS", max: 4 });

    const ok = (await journey(pax.slice(0, 4))).json().journey;
    expect(item(ok.readiness, "passenger_count")).toMatchObject({ status: "PASS", detail: "4 of at most 4." });
    expect((await post(`/api/journeys/${ok.id}/passengers`, { passengerId: pax[4] })).json().error.code).toBe("TOO_MANY_PASSENGERS");
    const put = await h.app.inject({ method: "PUT", url: `/api/journeys/${ok.id}/passengers`, headers: auth, payload: { passengers: pax.map((passengerId) => ({ passengerId })) } });
    expect(put.statusCode).toBe(400);
  });

  it("applies to templates, and each quota reads its own rule", async () => {
    const t = await post("/api/journey-templates", { name: "Big group", fromStationCode: "BCT", toStationCode: "NDLS", passengers: pax.map((passengerId) => ({ passengerId })) });
    expect(t.json().error.code).toBe("TOO_MANY_PASSENGERS");
    const general = await journey(pax, { quota: "GENERAL" });
    expect(general.statusCode).toBe(201); // 5 ≤ 6 under the (unverified) general rule
    const { readiness } = general.json().journey;
    expect(item(readiness, "rules_verified")?.detail).toMatch(/Passengers per booking \(General\) \(not verified\)/);
    // Switching that journey to Tatkal would break the Tatkal limit.
    const res = await h.app.inject({ method: "PATCH", url: `/api/journeys/${general.json().journey.id}`, headers: auth, payload: { quota: "TATKAL" } });
    expect(res.json().error.code).toBe("TOO_MANY_PASSENGERS");
  });

  it("the options endpoint exposes the limit with its verification state", async () => {
    const o = (await get("/api/journey-options")).json();
    expect(o.rules.passengerLimit.TATKAL).toMatchObject({ value: 4, verificationStatus: "VERIFIED", isVerified: true });
    expect(o.rules.passengerLimit.PREMIUM_TATKAL).toMatchObject({ value: 4 });
    expect(o.rules.passengerLimit.GENERAL).toMatchObject({ value: 6, verificationStatus: "UNVERIFIED", isVerified: false });
  });
});

describe("passenger-name length", () => {
  it("is checked against the rule, and fails readiness for longer names", async () => {
    await h.c.rules.syncFromRegistry([rule("passenger.name_max_length", 16, false)]);
    const { journey: j } = (await journey([pax[1]!, pax[4]!])).json();
    expect(item(j.readiness, "passenger_names")).toMatchObject({ status: "FAIL" });
    expect(item(j.readiness, "passenger_names")?.detail).toMatch(/at most 16 characters\. Shorten: Siddharth Sancheti/);
    expect(j.readiness.overall).toBe("NOT_READY");
    expect(item(j.readiness, "rules_verified")?.detail).toMatch(/Passenger name length \(not verified\)/);
    expect((await get("/api/journey-options")).json().rules.nameMaxLength).toMatchObject({ value: 16, isVerified: false });
  });
});

describe("senior-citizen concession on Tatkal", () => {
  // (That an unverified "available" value still never grants it is covered by the shared unit tests.)
  it("is never offered: the verified rule says unavailable, and the journey says so", async () => {
    const { journey: j } = (await journey([pax[0]!])).json();
    expect(item(j.readiness, "senior_concession")).toMatchObject({ status: "INFO" });
    expect(item(j.readiness, "senior_concession")?.detail).toMatch(/isn't available on Tatkal bookings\. Meera will be booked at the normal Tatkal fare/);
    // Verified in the registry, so it is not listed as a rule gap.
    expect(item(j.readiness, "rules_verified")?.detail).not.toMatch(/Senior-citizen concession/);
    expect((await get("/api/journey-options")).json().rules.seniorConcessionOnTatkal).toMatchObject({ concession: "UNAVAILABLE", value: false, verificationStatus: "VERIFIED", isVerified: true });
  });
});

describe("booking readiness", () => {
  let id: string;

  it("is NOT READY without an IRCTC user ID, and READY once everything is configured and verified", async () => {
    // Rules this journey relies on, all verified (test values).
    await h.c.rules.syncFromRegistry([
      rule("passenger.name_max_length", 16, true), // same value as above, now verified
      ...["tatkal.ac.opening_time", "tatkal.advance_days", "tatkal.timezone", "tatkal.ac_classes"].map(verifyShipped),
    ]);

    const created = (await journey([pax[1]!, pax[2]!], { classes: ["2A", "3A"] })).json().journey;
    id = created.id;
    expect(created.readiness.overall).toBe("NOT_READY");
    expect(item(created.readiness, "irctc_account")).toMatchObject({ status: "FAIL" });

    await h.app.inject({ method: "PUT", url: "/api/me/irctc-account", headers: auth, payload: { irctcUserId: "tatkal_user1", keepSignedInPreference: false } });
    const r = (await get(`/api/journeys/${id}/readiness`)).json();
    expect(r.items.filter((i: { status: string }) => i.status !== "PASS" && i.status !== "INFO")).toEqual([]);
    expect(r.overall).toBe("READY");
  });

  it("drops to WARNING when a relied-on rule is unverified, and NOT READY when something required is missing", async () => {
    // A non-AC class needs the (missing) non-AC rules.
    await h.app.inject({ method: "POST", url: `/api/journeys/${id}/classes`, headers: auth, payload: { classCode: "SL" } });
    let r = (await get(`/api/journeys/${id}/readiness`)).json();
    expect(r.overall).toBe("WARNING");
    expect(item(r, "class_rules")?.detail).toMatch(/SL/);

    await h.app.inject({ method: "PUT", url: `/api/journeys/${id}/trains`, headers: auth, payload: { trains: [] } });
    r = (await get(`/api/journeys/${id}/readiness`)).json();
    expect(r.overall).toBe("NOT_READY");
    expect(item(r, "trains")).toMatchObject({ status: "FAIL" });
    await h.app.inject({ method: "PATCH", url: `/api/journeys/${id}`, headers: auth, payload: { anyTrainAllowed: true } });
    expect(item((await get(`/api/journeys/${id}/readiness`)).json(), "trains")).toMatchObject({ status: "PASS" });
  });

  it("keeps the creation-time rule snapshot and reports rules that changed since", async () => {
    const before = (await get(`/api/journeys/${id}`)).json();
    await h.c.rules.syncFromRegistry([verifyShipped("tatkal.non_ac.opening_time")]);
    const after = (await get(`/api/journeys/${id}`)).json();
    expect(after.ruleSnapshot).toEqual(before.ruleSnapshot); // history is unchanged
    expect(after.ruleSnapshot.rules["tatkal.non_ac.opening_time"].verificationStatus).toBe("UNVERIFIED");
    expect(item(after.readiness, "rules_changed")).toMatchObject({ status: "INFO" });
    expect(item(after.readiness, "rules_changed")?.detail).toMatch(/Tatkal opening time \(non-AC\)/);
  });
});
