import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED_RULES } from "../prisma/seed-data.js";
import { createHarness, signIn, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

const system = { actorType: "SYSTEM" as const };

describe("RailwayRulesService", () => {
  it("resolves seeded rules with provenance", async () => {
    const rule = await h.c.rules.get("tatkal.ac.opening_time");
    expect(rule.value).toBe("10:00");
    expect(rule.source).toMatch(/IRCTC/);
    expect(rule.effectiveFrom.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(rule.lastVerifiedAt).toBeNull(); // must be verified by an operator
    expect(await h.c.rules.getValue("tatkal.non_ac.opening_time")).toBe("11:00");
    expect(await h.c.rules.getValue("tatkal.advance_days")).toBe(1);
  });

  it("seeds every rule exactly once and is idempotent", async () => {
    const { seed } = await import("../prisma/seed.js");
    const again = await seed(h.db);
    expect(again.rulesCreated).toBe(0);
    for (const r of SEED_RULES) {
      expect(await h.db.railwayRule.count({ where: { ruleKey: r.ruleKey } })).toBe(1);
    }
  });

  it("rejects values that don't match the rule's type", async () => {
    await expect(
      h.c.rules.create(
        { ruleKey: "tatkal.ac.opening_time", value: "10am", source: "test source", effectiveFrom: "2030-01-01T00:00:00.000Z", effectiveTo: null, lastVerifiedAt: null, status: "DRAFT" },
        system,
      ),
    ).rejects.toThrow();
  });

  it("rejects overlapping ACTIVE periods", async () => {
    await expect(
      h.c.rules.create(
        { ruleKey: "tatkal.ac.opening_time", value: "09:30", source: "test source", effectiveFrom: "2027-01-01T00:00:00.000Z", effectiveTo: null, lastVerifiedAt: null, status: "ACTIVE" },
        system,
      ),
    ).rejects.toMatchObject({ code: "RULE_OVERLAP" });
  });

  it("supersedes a rule from a future date without touching earlier journeys", async () => {
    const changeAt = new Date("2027-04-01T00:00:00.000Z");
    await h.c.rules.supersede(
      { ruleKey: "tatkal.ac.opening_time", value: "09:30", source: "Hypothetical IRCTC circular (test)", effectiveFrom: changeAt.toISOString(), lastVerifiedAt: null },
      system,
    );
    expect(await h.c.rules.getValue("tatkal.ac.opening_time", new Date("2027-03-31T23:59:59.000Z"))).toBe("10:00");
    expect(await h.c.rules.getValue("tatkal.ac.opening_time", changeAt)).toBe("09:30");

    const audit = await h.db.auditLog.findMany({ where: { action: "rules.changed", metadata: { path: ["ruleKey"], equals: "tatkal.ac.opening_time" } } });
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it("fails loudly (503) when a rule is not configured, instead of guessing", async () => {
    await expect(h.c.rules.get("tatkal.ac.opening_time", new Date("2025-06-01T00:00:00.000Z"))).rejects.toMatchObject({
      code: "RULE_NOT_CONFIGURED",
      statusCode: 503,
    });
  });

  it("ignores DRAFT and RETIRED rules", async () => {
    await h.c.rules.create(
      { ruleKey: "tatkal.max_passengers_per_pnr", value: 6, source: "draft for review", effectiveFrom: "2026-02-01T00:00:00.000Z", effectiveTo: null, lastVerifiedAt: null, status: "DRAFT" },
      system,
    );
    expect(await h.c.rules.getValue("tatkal.max_passengers_per_pnr")).toBe(4);
  });

  it("exposes active rules to signed-in users", async () => {
    const { accessToken } = await signIn(h);
    const res = await h.app.inject({ method: "GET", url: "/api/rules/active", headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.statusCode).toBe(200);
    const keys = res.json().map((r: { ruleKey: string }) => r.ruleKey);
    expect(keys).toEqual(expect.arrayContaining(["tatkal.ac.opening_time", "tatkal.advance_days"]));
    expect((await h.app.inject({ method: "GET", url: "/api/rules/active" })).statusCode).toBe(401);
  });
});
