import type { RailwayRuleInput } from "@tatkalflow/shared";

/**
 * Baseline railway rules. `lastVerifiedAt` is deliberately null: these values
 * reflect published IRCTC/Indian Railways rules as understood at build time and
 * MUST be verified against the official source by an operator before launch
 * (see README → "Verifying railway rules").
 */
const SOURCE = "IRCTC / Indian Railways published Tatkal & reservation rules — verify at https://www.irctc.co.in before launch";
const EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";

const rule = (ruleKey: RailwayRuleInput["ruleKey"], value: unknown, notes?: string): RailwayRuleInput => ({
  ruleKey,
  value,
  source: SOURCE,
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  lastVerifiedAt: null,
  status: "ACTIVE",
  notes: notes ?? null,
});

export const SEED_RULES: RailwayRuleInput[] = [
  rule("tatkal.ac.opening_time", "10:00", "IST, on the opening day for AC classes"),
  rule("tatkal.non_ac.opening_time", "11:00", "IST, on the opening day for non-AC classes"),
  rule("tatkal.advance_days", 1, "Tatkal opens N days before the journey date (from the train's originating station)"),
  rule("tatkal.timezone", "Asia/Kolkata"),
  rule("tatkal.ac_classes", ["1A", "2A", "3A", "3E", "CC", "EC"]),
  rule("tatkal.non_ac_classes", ["SL", "2S"]),
  rule("tatkal.max_passengers_per_pnr", 4),
  rule("general.max_passengers_per_pnr", 6),
  rule("booking.advance_reservation_days", 60, "ARP; verify — this has changed several times"),
  rule("senior_citizen.min_age.male", 60),
  rule("senior_citizen.min_age.female", 58),
  rule("child.no_berth_max_age", 4, "Children below 5 travel free without a berth"),
];

export const SEED_SETTINGS = [
  { key: "feature.web_push", value: true, description: "Enable Web Push reminders" },
  { key: "feature.email_notifications", value: false, description: "Enable email reminders (needs provider)" },
  { key: "feature.sms_notifications", value: false, description: "Enable SMS reminders (needs provider)" },
  { key: "irctc.adapter", value: "manual", description: "Active IRCTC adapter: manual | mock" },
];
