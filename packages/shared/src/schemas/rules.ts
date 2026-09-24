import { z } from "zod";

export const RULE_STATUSES = ["DRAFT", "ACTIVE", "RETIRED"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/**
 * Every railway rule the app depends on has a known key and a typed value.
 * Adding a rule means adding it here (with its value schema) and seeding it —
 * callers never hardcode the value itself.
 */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm");

export const ruleValueSchemas = {
  "tatkal.ac.opening_time": hhmm,
  "tatkal.non_ac.opening_time": hhmm,
  "tatkal.advance_days": z.number().int().min(0).max(30),
  "tatkal.timezone": z.string().min(1),
  "tatkal.ac_classes": z.array(z.string().min(1)).min(1),
  "tatkal.non_ac_classes": z.array(z.string().min(1)).min(1),
  "tatkal.max_passengers_per_pnr": z.number().int().min(1).max(12),
  "general.max_passengers_per_pnr": z.number().int().min(1).max(12),
  "booking.advance_reservation_days": z.number().int().min(1).max(365),
  "senior_citizen.min_age.male": z.number().int().min(0).max(120),
  "senior_citizen.min_age.female": z.number().int().min(0).max(120),
  "child.no_berth_max_age": z.number().int().min(0).max(18),
} as const;

export type RuleKey = keyof typeof ruleValueSchemas;
export type RuleValue<K extends RuleKey> = z.infer<(typeof ruleValueSchemas)[K]>;
export const RULE_KEYS = Object.keys(ruleValueSchemas) as RuleKey[];

export function isRuleKey(key: string): key is RuleKey {
  return Object.hasOwn(ruleValueSchemas, key);
}

export const railwayRuleSchema = z
  .object({
    ruleKey: z.string().refine(isRuleKey, "Unknown rule key"),
    value: z.unknown(),
    source: z.string().trim().min(3).max(500),
    effectiveFrom: z.iso.datetime(),
    effectiveTo: z.iso.datetime().nullable(),
    lastVerifiedAt: z.iso.datetime().nullable(),
    status: z.enum(RULE_STATUSES),
    notes: z.string().max(2000).nullable().optional(),
  })
  .superRefine((rule, ctx) => {
    if (isRuleKey(rule.ruleKey)) {
      const parsed = ruleValueSchemas[rule.ruleKey].safeParse(rule.value);
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", path: ["value"], message: parsed.error.issues[0]?.message ?? "Invalid value" });
      }
    }
    if (rule.effectiveTo && rule.effectiveTo <= rule.effectiveFrom) {
      ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must be after effectiveFrom" });
    }
  });
export type RailwayRuleInput = z.input<typeof railwayRuleSchema>;
