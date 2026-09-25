import type { RailwayRuleInput } from "@tatkalflow/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { loadRulesRegistry } from "../src/modules/rules/registry.js";
import { RailwayRulesService } from "../src/modules/rules/railway-rules.service.js";
import { createHarness, signIn, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

const registry = () => loadRulesRegistry();
function service(enforceVerification: boolean) {
  return new RailwayRulesService(h.db, h.clock, new AuditService(h.db), { enforceVerification, reverifyAfterDays: 90 });
}
function entry(key: RailwayRuleInput["ruleKey"]): RailwayRuleInput {
  const e = registry().find((r) => r.ruleKey === key);
  if (!e) throw new Error(`registry has no ${key}`);
  return e;
}
const EVIDENCE = {
  sourceUrl: "https://www.irctc.co.in/example-official-rule-page",
  lastVerifiedAt: "2026-09-20T00:00:00.000Z",
  verifiedBy: "ops@tatkalflow (test)",
};

describe("rules registry (source-controlled)", () => {
  // Phase 3 brief values (UNVERIFIED) plus the two rules the product owner
  // verified against official IRCTC guidance in Phase 4 (VERIFIED, with evidence).
  const BRIEF_KEYS = ["tatkal.ac.opening_time", "tatkal.ac_classes", "tatkal.advance_days", "tatkal.non_ac.opening_time", "tatkal.timezone"];
  const VERIFIED_KEYS = ["tatkal.max_passengers_per_pnr", "tatkal.senior_citizen_concession_available"];

  it("ships the product brief values as UNVERIFIED and only owner-verified values as VERIFIED", () => {
    const rules = registry();
    expect(rules.map((r) => r.ruleKey).sort()).toEqual([...BRIEF_KEYS, ...VERIFIED_KEYS].sort());
    for (const r of rules.filter((x) => BRIEF_KEYS.includes(x.ruleKey))) {
      expect(r.verificationStatus).toBe("UNVERIFIED");
      expect(r.lastVerifiedAt).toBeNull();
      expect(r.sourceUrl).toBeNull();
    }
    for (const r of rules.filter((x) => VERIFIED_KEYS.includes(x.ruleKey))) {
      expect(r).toMatchObject({
        verificationStatus: "VERIFIED",
        sourceUrl: "https://contents.irctc.co.in/en/TatkalBooking.html",
        lastVerifiedAt: "2026-09-25T00:00:00.000Z",
        verifiedBy: "Sancheti Associates",
      });
    }
    expect(entry("tatkal.max_passengers_per_pnr").value).toBe(4);
    expect(entry("tatkal.senior_citizen_concession_available").value).toBe(false);
  });

  it("is applied by the seed and resolves with provenance, flagged as unverified", async () => {
    const rule = await h.c.rules.get("tatkal.ac.opening_time");
    expect(rule.value).toBe("10:00");
    expect(rule.source).toMatch(/product brief/);
    expect(rule.verificationStatus).toBe("UNVERIFIED");
    expect(rule.isVerified).toBe(false);
  });

  it("re-syncing is idempotent", async () => {
    const report = await h.c.rules.syncFromRegistry(registry());
    expect(report.created).toEqual([]);
    expect(report.updated).toEqual([]);
    expect(report.unchanged).toBe(registry().length);
  });

  it("does not invent rules that weren't supplied or verified", async () => {
    await expect(h.c.rules.get("tatkal.non_ac_classes")).rejects.toMatchObject({ code: "RULE_NOT_CONFIGURED", statusCode: 503 });
    // Official sources conflict (15 vs 16), so the name-length rule stays out of the registry.
    await expect(h.c.rules.get("passenger.name_max_length")).rejects.toMatchObject({ code: "RULE_NOT_CONFIGURED" });
    const limit = await service(true).getForBooking("tatkal.max_passengers_per_pnr");
    expect(limit).toMatchObject({ value: 4, isVerified: true, verifiedBy: "Sancheti Associates" });
  });
});

describe("verification", () => {
  it("rejects VERIFIED without source URL, date and verifier", async () => {
    await expect(
      h.c.rules.syncFromRegistry([{ ...entry("tatkal.timezone"), verificationStatus: "VERIFIED" }]),
    ).rejects.toThrow(/sourceUrl|lastVerifiedAt|verifiedBy/);
    await expect(
      h.c.rules.syncFromRegistry([{ ...entry("tatkal.timezone"), verificationStatus: "VERIFIED", ...EVIDENCE, sourceUrl: "http://insecure.example" }]),
    ).rejects.toThrow();
  });

  it("distinguishes 'exists' from 'verified' when enforcement is on", async () => {
    const enforced = service(true);
    // Exists:
    expect((await enforced.get("tatkal.advance_days")).value).toBe(1);
    // …but may not be relied on for booking:
    await expect(enforced.getForBooking("tatkal.advance_days")).rejects.toMatchObject({ code: "RULE_UNVERIFIED", statusCode: 503 });
    // Without enforcement (dev) it is returned, clearly marked unverified:
    const relaxed = await service(false).getForBooking("tatkal.advance_days");
    expect(relaxed.isVerified).toBe(false);
  });

  it("accepts a rule once verified in the registry, and audits the change", async () => {
    const verified = { ...entry("tatkal.advance_days"), verificationStatus: "VERIFIED" as const, ...EVIDENCE };
    const report = await h.c.rules.syncFromRegistry([verified]);
    expect(report.updated).toHaveLength(1);

    const rule = await service(true).getForBooking("tatkal.advance_days");
    expect(rule.isVerified).toBe(true);
    expect(rule.sourceUrl).toBe(EVIDENCE.sourceUrl);

    const audit = await h.db.auditLog.findFirst({ where: { action: "rules.changed", entityId: rule.id }, orderBy: { createdAt: "desc" } });
    expect(audit?.metadata).toMatchObject({ ruleKey: "tatkal.advance_days", verificationStatus: "VERIFIED" });
  });

  it("flags verified rules that are due for re-verification", async () => {
    h.clock.advance(120 * 86_400_000);
    const rule = await service(true).getForBooking("tatkal.advance_days");
    expect(rule.needsReverification).toBe(true);
    h.clock.advance(-120 * 86_400_000);
  });

  it("reports critical gaps", async () => {
    const gaps = await service(true).verificationGaps();
    const byKey = Object.fromEntries(gaps.map((g) => [g.ruleKey, g.state]));
    expect(byKey["tatkal.ac.opening_time"]).toBe("UNVERIFIED");
    expect(byKey["tatkal.max_passengers_per_pnr"]).toBeUndefined(); // verified in the registry
    expect(byKey["tatkal.senior_citizen_concession_available"]).toBeUndefined(); // verified in the registry
    expect(byKey["passenger.name_max_length"]).toBe("MISSING");
    expect(byKey["tatkal.advance_days"]).toBeUndefined(); // verified above
  });
});

describe("versioning", () => {
  it("values are immutable per (ruleKey, effectiveFrom)", async () => {
    await expect(h.c.rules.syncFromRegistry([{ ...entry("tatkal.ac.opening_time"), value: "09:30" }])).rejects.toMatchObject({
      code: "RULE_VALUE_IMMUTABLE",
    });
  });

  it("rejects a new ACTIVE version that overlaps the current one", async () => {
    await expect(
      h.c.rules.syncFromRegistry([{ ...entry("tatkal.ac.opening_time"), value: "09:30", effectiveFrom: "2027-04-01T00:00:00.000Z" }]),
    ).rejects.toMatchObject({ code: "RULE_OVERLAP" });
  });

  it("supersedes by closing the old period and adding a new version", async () => {
    const changeAt = "2027-04-01T00:00:00.000Z";
    const old = { ...entry("tatkal.ac.opening_time"), effectiveTo: changeAt, verificationStatus: "SUPERSEDED" as const };
    const next = { ...entry("tatkal.ac.opening_time"), value: "09:30", source: "Hypothetical circular (test only)", effectiveFrom: changeAt };
    const report = await h.c.rules.syncFromRegistry([old, next]);
    expect(report.updated).toHaveLength(1);
    expect(report.created).toHaveLength(1);

    expect(await h.c.rules.getValue("tatkal.ac.opening_time", new Date("2027-03-31T23:59:59.000Z"))).toBe("10:00");
    expect(await h.c.rules.getValue("tatkal.ac.opening_time", new Date(changeAt))).toBe("09:30");
  });

  it("marks verified rules EXPIRED once their period has ended", async () => {
    const e = { ...entry("tatkal.timezone"), verificationStatus: "VERIFIED" as const, ...EVIDENCE, effectiveTo: "2026-10-01T00:00:00.000Z" };
    await h.c.rules.syncFromRegistry([e]);
    h.clock.set(new Date("2026-10-02T00:00:00.000Z"));
    expect(await h.c.rules.expireLapsed()).toBe(1);
    const row = await h.db.railwayRule.findFirstOrThrow({ where: { ruleKey: "tatkal.timezone" } });
    expect(row.verificationStatus).toBe("EXPIRED");
    await expect(service(true).getForBooking("tatkal.timezone")).rejects.toMatchObject({ code: "RULE_NOT_CONFIGURED" });
    h.clock.set(new Date("2026-09-25T04:30:00.000Z"));
  });

  it("reports ACTIVE database rules that are missing from the registry", async () => {
    // An empty registry manages nothing, so every ACTIVE row is reported (and none deleted).
    const report = await h.c.rules.syncFromRegistry([]);
    expect(report.unmanaged.some((u) => u.startsWith("tatkal.ac_classes@"))).toBe(true);
    expect(await h.db.railwayRule.count({ where: { ruleKey: "tatkal.ac_classes" } })).toBe(1);
  });
});

describe("API", () => {
  it("exposes rules with verification state and gaps to signed-in users", async () => {
    const { accessToken } = await signIn(h);
    const res = await h.app.inject({ method: "GET", url: "/api/rules/active", headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enforcement).toBe(false); // test env
    const ac = body.rules.find((r: { ruleKey: string }) => r.ruleKey === "tatkal.ac_classes");
    expect(ac).toMatchObject({ verificationStatus: "UNVERIFIED", isVerified: false });
    expect(body.gaps.length).toBeGreaterThan(0);
    expect((await h.app.inject({ method: "GET", url: "/api/rules/active" })).statusCode).toBe(401);
  });
});
