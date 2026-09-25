import { describe, expect, it } from "vitest";
import {
  buildRuleSnapshot,
  changedRuleKeys,
  classTatkalCategory,
  computeReadiness,
  CRITICAL_RULE_KEYS,
  DEFAULT_CLASS_PRIORITY,
  JOURNEY_DEFAULTS,
  JOURNEY_RULE_KEYS,
  journeyCreateSchema,
  journeyDraftSchema,
  journeyTemplateInputSchema,
  journeyTemplateUpdateSchema,
  journeyUpdateSchema,
  moveItem,
  namesOverLimit,
  nameLength,
  passengerLimitRuleKey,
  relevantRuleKeys,
  ruleSnapshotSchema,
  ruleValueSchemas,
  seniorConcessionOnQuota,
  withPriorities,
  type ReadinessInput,
  type RuleLike,
} from "../index.js";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const base = { name: "Diwali trip", fromStationCode: "BCT", toStationCode: "NDLS" };

describe("journey template validation", () => {
  it("applies the product defaults, including class priority 2A → 3A → 3E", () => {
    const t = journeyTemplateInputSchema.parse(base);
    expect(t.classes).toEqual(["2A", "3A", "3E"]);
    expect(DEFAULT_CLASS_PRIORITY).toEqual(["2A", "3A", "3E"]);
    expect(t).toMatchObject({
      quota: "TATKAL",
      boardingStationCode: null,
      passengers: [],
      trains: [],
      anyTrainAllowed: false,
      useNextAvailableClass: true,
      considerAutoUpgradation: true,
      racWaitlistPreference: "ALLOW_WAITLIST",
    });
  });

  it("requires a name and distinct From/To, and normalises station codes", () => {
    expect(journeyTemplateInputSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
    const same = journeyTemplateInputSchema.safeParse({ ...base, toStationCode: "bct" });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0]).toMatchObject({ path: ["toStationCode"], message: "From and To must be different" });
    expect(journeyTemplateInputSchema.parse({ ...base, fromStationCode: "bct", toStationCode: "ndls" }).fromStationCode).toBe("BCT");
  });

  it("rejects a boarding point at the destination, and treats boarding at the origin as none", () => {
    const bad = journeyTemplateInputSchema.safeParse({ ...base, boardingStationCode: "NDLS" });
    expect(bad.error?.issues[0]?.path).toEqual(["boardingStationCode"]);
    expect(journeyTemplateInputSchema.parse({ ...base, boardingStationCode: "BCT" }).boardingStationCode).toBeNull();
    expect(journeyTemplateInputSchema.parse({ ...base, boardingStationCode: "BVI" }).boardingStationCode).toBe("BVI");
  });

  it("refuses unknown fields (no user IDs or identity data can be smuggled in)", () => {
    expect(journeyTemplateInputSchema.safeParse({ ...base, userId: P1 }).success).toBe(false);
    expect(journeyTemplateInputSchema.safeParse({ ...base, irctcPassword: "x" }).success).toBe(false);
  });

  it("partial updates don't re-apply defaults", () => {
    expect(journeyTemplateUpdateSchema.parse({ considerAutoUpgradation: false })).toEqual({ considerAutoUpgradation: false });
    expect(journeyTemplateUpdateSchema.safeParse({ fromStationCode: "BCT", toStationCode: "BCT" }).success).toBe(false);
  });
});

describe("journey (instance) validation", () => {
  it("still accepts the Phase 3 draft payload", () => {
    const legacy = { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [P1] };
    expect(journeyDraftSchema.safeParse(legacy).success).toBe(true);
    const j = journeyCreateSchema.parse(legacy);
    expect(j.passengers).toEqual([{ passengerId: P1 }]);
    expect(j.classes).toEqual(["2A", "3A", "3E"]);
    expect(j.name).toBeUndefined();
  });

  it("needs at least one passenger, and one way of sending them", () => {
    const noPax = journeyCreateSchema.safeParse({ fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25" });
    expect(noPax.error?.issues.map((i) => i.message)).toContain("Select at least one passenger");
    const both = journeyCreateSchema.safeParse({
      fromStationCode: "BCT",
      toStationCode: "NDLS",
      journeyDate: "2026-10-25",
      passengerIds: [P1],
      passengers: [{ passengerId: P2 }],
    });
    expect(both.success).toBe(false);
  });

  it("rejects duplicate passengers, trains and classes", () => {
    const j = { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25" };
    expect(journeyCreateSchema.safeParse({ ...j, passengers: [{ passengerId: P1 }, { passengerId: P1 }] }).success).toBe(false);
    expect(journeyCreateSchema.safeParse({ ...j, passengerIds: [P1], trains: ["12951", "12951"] }).success).toBe(false);
    expect(journeyCreateSchema.safeParse({ ...j, passengerIds: [P1], classes: ["3A", "3A"] }).success).toBe(false);
  });

  it("validates train numbers, class codes and dates", () => {
    const j = { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [P1] };
    expect(journeyCreateSchema.safeParse({ ...j, trains: ["1295"] }).success).toBe(false);
    expect(journeyCreateSchema.safeParse({ ...j, trains: ["abcde"] }).success).toBe(false);
    expect(journeyCreateSchema.safeParse({ ...j, classes: ["XX"] }).success).toBe(false);
    expect(journeyCreateSchema.safeParse({ ...j, classes: [] }).success).toBe(false);
    expect(journeyCreateSchema.safeParse({ ...j, journeyDate: "2026-02-30" }).success).toBe(false);
    expect(journeyCreateSchema.safeParse({ ...j, trains: ["10001", "10002", "10003", "10004", "10005", "10006"] }).success).toBe(false);
  });

  it("stores berth, RAC/waitlist and auto-upgrade choices as sent", () => {
    const j = journeyCreateSchema.parse({
      fromStationCode: "BCT",
      toStationCode: "NDLS",
      journeyDate: "2026-10-25",
      passengers: [{ passengerId: P1, berthPreference: "SIDE_LOWER" }, { passengerId: P2 }],
      considerAutoUpgradation: false,
      racWaitlistPreference: "CONFIRMED_ONLY",
    });
    expect(j.passengers[0]).toEqual({ passengerId: P1, berthPreference: "SIDE_LOWER" });
    expect(j.passengers[1]).toEqual({ passengerId: P2 });
    expect(j.considerAutoUpgradation).toBe(false);
    expect(j.racWaitlistPreference).toBe("CONFIRMED_ONLY");
    for (const bad of [{ racWaitlistPreference: "MAYBE" }, { considerAutoUpgradation: "yes" }, { passengers: [{ passengerId: P1, berthPreference: "TOP" }] }]) {
      expect(journeyUpdateSchema.safeParse(bad).success).toBe(false);
    }
    expect(JOURNEY_DEFAULTS.considerAutoUpgradation).toBe(true);
  });
});

describe("priority ordering", () => {
  it("array order is the explicit priority", () => {
    expect(withPriorities(["12951", "12953", "22209"])).toEqual([
      { priority: 1, item: "12951" },
      { priority: 2, item: "12953" },
      { priority: 3, item: "22209" },
    ]);
  });

  it("reorders trains and classes without losing items", () => {
    expect(moveItem(["2A", "3A", "3E"], 2, 0)).toEqual(["3E", "2A", "3A"]);
    expect(moveItem(["A", "B", "C"], 0, 1)).toEqual(["B", "A", "C"]);
    expect(moveItem(["A", "B"], 1, 5)).toEqual(["A", "B"]); // out of range is a no-op
    const original = ["A", "B"];
    moveItem(original, 0, 1);
    expect(original).toEqual(["A", "B"]); // pure
  });
});

describe("rule-driven passenger checks", () => {
  it("uses the Tatkal limit for Tatkal quotas and the general one otherwise", () => {
    expect(passengerLimitRuleKey("TATKAL")).toBe("tatkal.max_passengers_per_pnr");
    expect(passengerLimitRuleKey("PREMIUM_TATKAL")).toBe("tatkal.max_passengers_per_pnr");
    expect(passengerLimitRuleKey("GENERAL")).toBe("general.max_passengers_per_pnr");
  });

  it("checks names against the configured length, counting characters not bytes", () => {
    expect(nameLength("  Meera  ")).toBe(5);
    expect(nameLength("मीरा")).toBe(4);
    expect(namesOverLimit(["Siddharth Sancheti", "Meera"], 16)).toEqual(["Siddharth Sancheti"]);
    expect(namesOverLimit(["Exactly Sixteen!"], 16)).toEqual([]);
    expect(namesOverLimit(["A very long name indeed"], null)).toEqual([]); // no rule → nothing to check against
  });

  it("the new rules have typed values and are critical", () => {
    expect(ruleValueSchemas["passenger.name_max_length"].safeParse(16).success).toBe(true);
    expect(ruleValueSchemas["passenger.name_max_length"].safeParse(0).success).toBe(false);
    expect(ruleValueSchemas["tatkal.senior_citizen_concession_available"].safeParse(false).success).toBe(true);
    expect(ruleValueSchemas["tatkal.senior_citizen_concession_available"].safeParse("no").success).toBe(false);
    expect(CRITICAL_RULE_KEYS).toEqual(expect.arrayContaining(["passenger.name_max_length", "tatkal.senior_citizen_concession_available"]));
  });

  it("senior-citizen concession on Tatkal fails closed", () => {
    expect(seniorConcessionOnQuota("TATKAL", null)).toBe("UNAVAILABLE");
    expect(seniorConcessionOnQuota("TATKAL", { value: false, isVerified: true })).toBe("UNAVAILABLE");
    expect(seniorConcessionOnQuota("TATKAL", { value: true, isVerified: false })).toBe("UNAVAILABLE"); // unverified never grants
    expect(seniorConcessionOnQuota("TATKAL", { value: true, isVerified: true })).toBe("AVAILABLE");
    expect(seniorConcessionOnQuota("GENERAL", null)).toBe("NOT_APPLICABLE");
  });
});

const verified = <T,>(value: T) => ({ value, isVerified: true });
const unverified = <T,>(value: T) => ({ value, isVerified: false });

function allVerified(): ReadinessInput["rules"] {
  return {
    "tatkal.max_passengers_per_pnr": verified(4),
    "general.max_passengers_per_pnr": verified(6),
    "passenger.name_max_length": verified(16),
    "tatkal.senior_citizen_concession_available": verified(false),
    "tatkal.ac_classes": verified(["2A", "3A", "3E"]),
    "tatkal.non_ac_classes": verified(["SL"]),
    "tatkal.ac.opening_time": verified("10:00"),
    "tatkal.non_ac.opening_time": verified("11:00"),
    "tatkal.advance_days": verified(1),
    "tatkal.timezone": verified("Asia/Kolkata"),
  };
}

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    today: "2026-09-25",
    journeyDate: "2026-10-25",
    from: { code: "BCT", active: true },
    to: { code: "NDLS", active: true },
    boarding: null,
    quota: "TATKAL",
    passengers: [{ name: "Meera", removed: false, seniorCitizenOptIn: false }],
    trains: [{ trainNumber: "90101", servesRoute: true }],
    anyTrainAllowed: false,
    classes: ["2A", "3A", "3E"],
    irctcLinked: true,
    rules: allVerified(),
    ...over,
  };
}
const status = (r: ReturnType<typeof computeReadiness>, key: string) => r.items.find((i) => i.key === key)?.status;

describe("booking readiness", () => {
  it("is READY only when everything is configured and every relied-on rule is verified", () => {
    const r = computeReadiness(input());
    expect(r.overall).toBe("READY");
    expect(r.items.every((i) => i.status === "PASS" || i.status === "INFO")).toBe(true);
  });

  it("never claims READY while a required rule is unverified or missing", () => {
    const unv = computeReadiness(input({ rules: { ...allVerified(), "tatkal.ac.opening_time": unverified("10:00") } }));
    expect(unv.overall).toBe("WARNING");
    expect(unv.items.find((i) => i.key === "rules_verified")?.detail).toMatch(/Tatkal opening time \(AC\) \(not verified\)/);

    const { ["passenger.name_max_length"]: _drop, ...rest } = allVerified();
    const missing = computeReadiness(input({ rules: rest }));
    expect(missing.overall).toBe("WARNING");
    expect(status(missing, "passenger_names")).toBe("WARN");
    expect(missing.items.find((i) => i.key === "rules_verified")?.detail).toMatch(/Passenger name length \(not configured\)/);
  });

  it("is NOT READY when something required is missing", () => {
    expect(computeReadiness(input({ passengers: [] })).overall).toBe("NOT_READY");
    expect(computeReadiness(input({ irctcLinked: false })).overall).toBe("NOT_READY");
    expect(computeReadiness(input({ classes: [] })).overall).toBe("NOT_READY");
    expect(computeReadiness(input({ from: null })).overall).toBe("NOT_READY");
    expect(computeReadiness(input({ to: { code: "NDLS", active: false } })).overall).toBe("NOT_READY");
    expect(computeReadiness(input({ journeyDate: "2026-09-24" })).overall).toBe("NOT_READY");
  });

  it("enforces the passenger limit from the rule, not a constant", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, removed: false, seniorCitizenOptIn: false }));
    const r = computeReadiness(input({ passengers: five }));
    expect(status(r, "passenger_count")).toBe("FAIL");
    expect(r.items.find((i) => i.key === "passenger_count")?.detail).toMatch(/At most 4/);
    // A different (verified) value changes the outcome without code changes.
    expect(status(computeReadiness(input({ passengers: five, rules: { ...allVerified(), "tatkal.max_passengers_per_pnr": verified(6) } })), "passenger_count")).toBe("PASS");
    // General quota reads its own rule.
    expect(status(computeReadiness(input({ passengers: five, quota: "GENERAL" })), "passenger_count")).toBe("PASS");
    // Missing rule → warning, not a silent pass.
    const { ["tatkal.max_passengers_per_pnr"]: _d, ...rest } = allVerified();
    const noRule = computeReadiness(input({ passengers: five, rules: rest }));
    expect(status(noRule, "passenger_count")).toBe("WARN");
    expect(noRule.overall).not.toBe("READY");
  });

  it("fails names longer than the rule allows", () => {
    const r = computeReadiness(input({ passengers: [{ name: "Siddharth Sancheti", removed: false, seniorCitizenOptIn: false }] }));
    expect(status(r, "passenger_names")).toBe("FAIL");
    expect(r.overall).toBe("NOT_READY");
  });

  it("says senior-citizen concession isn't available on Tatkal", () => {
    const r = computeReadiness(input({ passengers: [{ name: "Meera", removed: false, seniorCitizenOptIn: true }] }));
    expect(r.items.find((i) => i.key === "senior_concession")).toMatchObject({ status: "INFO" });
    expect(r.items.find((i) => i.key === "senior_concession")?.detail).toMatch(/isn't available on Tatkal/);
    // The concession rule only matters when someone opted in.
    expect(relevantRuleKeys(input())).not.toContain("tatkal.senior_citizen_concession_available");
    expect(relevantRuleKeys(input({ passengers: [{ name: "M", removed: false, seniorCitizenOptIn: true }] }))).toContain(
      "tatkal.senior_citizen_concession_available",
    );
  });

  it("needs a train unless any train is allowed, and flags trains off the route", () => {
    expect(status(computeReadiness(input({ trains: [] })), "trains")).toBe("FAIL");
    expect(status(computeReadiness(input({ trains: [], anyTrainAllowed: true })), "trains")).toBe("PASS");
    expect(status(computeReadiness(input({ trains: [{ trainNumber: "90101", servesRoute: false }] })), "trains")).toBe("WARN");
  });

  it("flags classes the Tatkal rules don't cover", () => {
    expect(classTatkalCategory("SL", allVerified())).toBe("NON_AC");
    expect(classTatkalCategory("1A", allVerified())).toBe("UNKNOWN");
    const r = computeReadiness(input({ classes: ["1A", "2A"] }));
    expect(status(r, "class_rules")).toBe("WARN");
    expect(computeReadiness(input({ classes: ["1A"], quota: "GENERAL" })).items.find((i) => i.key === "class_rules")).toBeUndefined();
  });

  it("warns about passengers removed from the saved list, and reports rule changes", () => {
    expect(status(computeReadiness(input({ passengers: [{ name: "Meera", removed: true, seniorCitizenOptIn: false }] })), "passenger_details")).toBe("WARN");
    const r = computeReadiness(input({ rulesChangedSinceCreation: ["tatkal.max_passengers_per_pnr"] }));
    expect(r.items.find((i) => i.key === "rules_changed")?.detail).toMatch(/Tatkal passengers per booking/);
  });

  it("templates (no date) skip the date check", () => {
    expect(computeReadiness(input({ journeyDate: null })).items.some((i) => i.key === "journey_date")).toBe(false);
  });
});

describe("rule snapshots", () => {
  const at = new Date("2026-09-25T04:30:00.000Z");
  const rule = (id: string, value: unknown, isVerified = false): RuleLike => ({
    id,
    value,
    source: "test",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    verificationStatus: isVerified ? "VERIFIED" : "UNVERIFIED",
    isVerified,
  });

  it("records every journey rule, marking missing ones as null", () => {
    const snap = buildRuleSnapshot(at, { "tatkal.ac_classes": rule("r1", ["2A"]) });
    expect(ruleSnapshotSchema.parse(snap)).toEqual(snap);
    expect(snap.version).toBe(1);
    expect(snap.capturedAt).toBe(at.toISOString());
    expect(Object.keys(snap.rules).sort()).toEqual([...JOURNEY_RULE_KEYS].sort());
    expect(snap.rules["tatkal.ac_classes"]).toMatchObject({ ruleId: "r1", value: ["2A"], verificationStatus: "UNVERIFIED", isVerified: false });
    expect(snap.rules["tatkal.max_passengers_per_pnr"]).toBeNull();
  });

  it("detects rules that were added, replaced or verified since", () => {
    const before = buildRuleSnapshot(at, { "tatkal.ac_classes": rule("r1", ["2A"]) });
    expect(changedRuleKeys(before, before)).toEqual([]);
    const after = buildRuleSnapshot(at, { "tatkal.ac_classes": rule("r1", ["2A"], true), "tatkal.max_passengers_per_pnr": rule("r2", 4) });
    expect(changedRuleKeys(before, after)).toEqual(["tatkal.ac_classes", "tatkal.max_passengers_per_pnr"]);
  });

  it("rejects malformed snapshots", () => {
    expect(ruleSnapshotSchema.safeParse({ version: 2, capturedAt: at.toISOString(), rules: {} }).success).toBe(false);
    expect(ruleSnapshotSchema.safeParse({ version: 1, capturedAt: "yesterday", rules: {} }).success).toBe(false);
  });
});
