import { z } from "zod";
import { RULE_VERIFICATION_STATUSES, type RuleKey } from "../schemas/rules.js";

/**
 * Railway rules a journey's configuration depends on. Their versions are
 * captured when a journey is created, so its history keeps the rule context
 * in force at that time (Phase 4 spec §14).
 */
export const JOURNEY_RULE_KEYS = [
  "tatkal.max_passengers_per_pnr",
  "general.max_passengers_per_pnr",
  "passenger.name_max_length",
  "tatkal.senior_citizen_concession_available",
  "tatkal.ac_classes",
  "tatkal.non_ac_classes",
  "tatkal.ac.opening_time",
  "tatkal.non_ac.opening_time",
  "tatkal.advance_days",
  "tatkal.timezone",
] as const satisfies readonly RuleKey[];
export type JourneyRuleKey = (typeof JOURNEY_RULE_KEYS)[number];

/** Human names for rules, for warnings and summaries. */
export const RULE_LABELS: Record<RuleKey, string> = {
  "tatkal.ac.opening_time": "Tatkal opening time (AC)",
  "tatkal.non_ac.opening_time": "Tatkal opening time (non-AC)",
  "tatkal.advance_days": "Tatkal booking window",
  "tatkal.timezone": "Tatkal timezone",
  "tatkal.ac_classes": "Tatkal AC classes",
  "tatkal.non_ac_classes": "Tatkal non-AC classes",
  "tatkal.max_passengers_per_pnr": "Tatkal passengers per booking",
  "general.max_passengers_per_pnr": "Passengers per booking (General)",
  "booking.advance_reservation_days": "Advance reservation period",
  "senior_citizen.min_age.male": "Senior-citizen age (male)",
  "senior_citizen.min_age.female": "Senior-citizen age (female)",
  "child.no_berth_max_age": "Child without berth age",
  "passenger.name_max_length": "Passenger name length",
  "tatkal.senior_citizen_concession_available": "Senior-citizen concession on Tatkal",
};

export const RULE_SNAPSHOT_VERSION = 1;

export const ruleSnapshotEntrySchema = z.object({
  ruleId: z.string(),
  value: z.unknown(),
  source: z.string(),
  effectiveFrom: z.iso.datetime(),
  verificationStatus: z.enum(RULE_VERIFICATION_STATUSES),
  isVerified: z.boolean(),
});
export type RuleSnapshotEntry = z.infer<typeof ruleSnapshotEntrySchema>;

/** `null` records that the rule was not configured when the snapshot was taken. */
export const ruleSnapshotSchema = z.object({
  version: z.literal(RULE_SNAPSHOT_VERSION),
  capturedAt: z.iso.datetime(),
  rules: z.record(z.string(), ruleSnapshotEntrySchema.nullable()),
});
export type RuleSnapshot = z.infer<typeof ruleSnapshotSchema>;

/** Anything shaped like a resolved rule (the API's ResolvedRule fits). */
export interface RuleLike {
  id: string;
  value: unknown;
  source: string;
  effectiveFrom: Date;
  verificationStatus: (typeof RULE_VERIFICATION_STATUSES)[number];
  isVerified: boolean;
}

export function buildRuleSnapshot(
  capturedAt: Date,
  rules: Partial<Record<RuleKey, RuleLike | null>>,
  keys: readonly RuleKey[] = JOURNEY_RULE_KEYS,
): RuleSnapshot {
  const out: RuleSnapshot["rules"] = {};
  for (const key of keys) {
    const r = rules[key];
    out[key] = r
      ? {
          ruleId: r.id,
          value: r.value,
          source: r.source,
          effectiveFrom: r.effectiveFrom.toISOString(),
          verificationStatus: r.verificationStatus,
          isVerified: r.isVerified,
        }
      : null;
  }
  return { version: RULE_SNAPSHOT_VERSION, capturedAt: capturedAt.toISOString(), rules: out };
}

/**
 * Rules whose version or verification state differs between a journey's
 * snapshot and the rules in force now (added, removed, replaced or verified).
 */
export function changedRuleKeys(snapshot: RuleSnapshot, current: RuleSnapshot): string[] {
  const keys = new Set([...Object.keys(snapshot.rules), ...Object.keys(current.rules)]);
  return [...keys]
    .filter((k) => {
      const a = snapshot.rules[k] ?? null;
      const b = current.rules[k] ?? null;
      if (!a || !b) return a !== b;
      return a.ruleId !== b.ruleId || a.verificationStatus !== b.verificationStatus;
    })
    .sort();
}
