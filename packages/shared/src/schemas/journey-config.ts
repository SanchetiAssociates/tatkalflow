import { z } from "zod";
import { calendarDateSchema } from "./journey.js";
import { BERTH_PREFERENCES } from "./passenger.js";
import { stationCodeSchema } from "./station.js";

// ── Reference data and product defaults (not railway rules) ─────────────
//
// Railway regulations (passenger limits, name length, which classes Tatkal
// covers, concessions, timings) live in the rules registry and are read
// through RailwayRulesService. Nothing below encodes such a rule.

export const QUOTAS = ["TATKAL", "PREMIUM_TATKAL", "GENERAL"] as const;
export type Quota = (typeof QUOTAS)[number];
export const QUOTA_LABELS: Record<Quota, string> = { TATKAL: "Tatkal", PREMIUM_TATKAL: "Premium Tatkal", GENERAL: "General" };
export const TATKAL_QUOTAS: readonly Quota[] = ["TATKAL", "PREMIUM_TATKAL"];
export const isTatkalQuota = (q: Quota): boolean => TATKAL_QUOTAS.includes(q);

/** Which booking outcomes the user is willing to accept. A preference only; nothing is booked here. */
export const RAC_WAITLIST_PREFERENCES = ["CONFIRMED_ONLY", "ALLOW_RAC", "ALLOW_WAITLIST"] as const;
export type RacWaitlistPreference = (typeof RAC_WAITLIST_PREFERENCES)[number];
export const RAC_WAITLIST_LABELS: Record<RacWaitlistPreference, string> = {
  CONFIRMED_ONLY: "Confirmed berths only",
  ALLOW_RAC: "Confirmed or RAC",
  ALLOW_WAITLIST: "Confirmed, RAC or waitlist",
};
export const RAC_WAITLIST_DESCRIPTIONS: Record<RacWaitlistPreference, string> = {
  CONFIRMED_ONLY: "Only go ahead if confirmed berths are available.",
  ALLOW_RAC: "Also accept RAC (a shared berth) if confirmed berths run out.",
  ALLOW_WAITLIST: "Also accept a waitlisted ticket. A waitlisted ticket may not get confirmed.",
};

/**
 * IRCTC travel-class codes the app can store. Reference data only: which of
 * these Tatkal covers, and when each opens, comes from the rules registry.
 */
export const TRAVEL_CLASSES = [
  { code: "1A", name: "AC First Class" },
  { code: "2A", name: "AC 2 Tier" },
  { code: "3A", name: "AC 3 Tier" },
  { code: "3E", name: "AC 3 Economy" },
  { code: "EC", name: "AC Executive Chair Car" },
  { code: "CC", name: "AC Chair Car" },
  { code: "SL", name: "Sleeper" },
  { code: "2S", name: "Second Sitting" },
] as const;
export type ClassCode = (typeof TRAVEL_CLASSES)[number]["code"];
export const CLASS_CODES = TRAVEL_CLASSES.map((c) => c.code) as [ClassCode, ...ClassCode[]];
export const CLASS_NAMES = Object.fromEntries(TRAVEL_CLASSES.map((c) => [c.code, c.name])) as Record<ClassCode, string>;

/** Product defaults (Phase 4 spec §7, and the Phase 2 schema defaults). */
export const DEFAULT_CLASS_PRIORITY: readonly ClassCode[] = ["2A", "3A", "3E"];
export const JOURNEY_DEFAULTS = {
  quota: "TATKAL" as Quota,
  anyTrainAllowed: false,
  useNextAvailableClass: true,
  considerAutoUpgradation: true,
  /** Matches IRCTC's own default of not restricting the outcome. */
  racWaitlistPreference: "ALLOW_WAITLIST" as RacWaitlistPreference,
};

/** Product caps (abuse guards), not railway rules. */
export const MAX_PREFERRED_TRAINS = 5;
export const MAX_JOURNEY_PASSENGERS = 12;
export const MAX_JOURNEY_TEMPLATES = 50;

// ── Field schemas ───────────────────────────────────────────────────────

export const trainNumberSchema = z.string().trim().regex(/^\d{5}$/, "Train numbers have 5 digits");
export const classCodeSchema = z.enum(CLASS_CODES, { message: "Choose a travel class" });

export const journeyNameSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, " "))
  .pipe(z.string().min(1, "Give this journey a name").max(60, "Keep the name under 60 characters"));

const unique = <T>(xs: T[]) => new Set(xs).size === xs.length;

export const passengerSelectionSchema = z
  .object({
    passengerId: z.uuid(),
    /** Berth for this journey. Defaults to the passenger's saved preference. */
    berthPreference: z.enum(BERTH_PREFERENCES).optional(),
  })
  .strict();
export type PassengerSelection = z.input<typeof passengerSelectionSchema>;

export const passengerListSchema = z
  .array(passengerSelectionSchema)
  .max(MAX_JOURNEY_PASSENGERS, "Too many passengers")
  .refine((ps) => unique(ps.map((p) => p.passengerId)), "A passenger is selected twice");

/** Array order is the priority: the first train is priority 1. */
export const trainListSchema = z
  .array(trainNumberSchema)
  .max(MAX_PREFERRED_TRAINS, `Choose up to ${MAX_PREFERRED_TRAINS} trains`)
  .refine(unique, "A train is listed twice");

/** Array order is the priority: the first class is priority 1. */
export const classListSchema = z
  .array(classCodeSchema)
  .min(1, "Choose at least one class")
  .max(CLASS_CODES.length)
  .refine(unique, "A class is listed twice");

/** Fields shared by templates and journeys, without defaults (safe for partial updates). */
const configFields = {
  name: journeyNameSchema,
  fromStationCode: stationCodeSchema,
  toStationCode: stationCodeSchema,
  boardingStationCode: stationCodeSchema.nullable(),
  quota: z.enum(QUOTAS),
  passengers: passengerListSchema,
  trains: trainListSchema,
  classes: classListSchema,
  anyTrainAllowed: z.boolean(),
  useNextAvailableClass: z.boolean(),
  considerAutoUpgradation: z.boolean(),
  racWaitlistPreference: z.enum(RAC_WAITLIST_PREFERENCES),
};

type RouteLike = { fromStationCode?: string; toStationCode?: string; boardingStationCode?: string | null };

/** From/To must differ, and the boarding point can't be the destination. */
function checkRoute(v: RouteLike, ctx: z.RefinementCtx) {
  if (v.fromStationCode && v.toStationCode && v.fromStationCode === v.toStationCode) {
    ctx.addIssue({ code: "custom", path: ["toStationCode"], message: "From and To must be different" });
  }
  if (v.boardingStationCode && v.toStationCode && v.boardingStationCode === v.toStationCode) {
    ctx.addIssue({ code: "custom", path: ["boardingStationCode"], message: "The boarding point can't be your destination" });
  }
}

/** Boarding at the origin is the same as having no separate boarding point. */
function normaliseBoarding<T extends RouteLike>(v: T): T {
  return v.boardingStationCode && v.boardingStationCode === v.fromStationCode ? { ...v, boardingStationCode: null } : v;
}

export { checkRoute as checkJourneyRoute };

// ── Templates ───────────────────────────────────────────────────────────

export const journeyTemplateInputSchema = z
  .object({
    ...configFields,
    boardingStationCode: configFields.boardingStationCode.default(null),
    quota: configFields.quota.default(JOURNEY_DEFAULTS.quota),
    passengers: configFields.passengers.default([]),
    trains: configFields.trains.default([]),
    classes: configFields.classes.default([...DEFAULT_CLASS_PRIORITY]),
    anyTrainAllowed: configFields.anyTrainAllowed.default(JOURNEY_DEFAULTS.anyTrainAllowed),
    useNextAvailableClass: configFields.useNextAvailableClass.default(JOURNEY_DEFAULTS.useNextAvailableClass),
    considerAutoUpgradation: configFields.considerAutoUpgradation.default(JOURNEY_DEFAULTS.considerAutoUpgradation),
    racWaitlistPreference: configFields.racWaitlistPreference.default(JOURNEY_DEFAULTS.racWaitlistPreference),
  })
  .strict()
  .superRefine(checkRoute)
  .transform(normaliseBoarding);
export type JourneyTemplateInput = z.input<typeof journeyTemplateInputSchema>;

/** Only the fields sent are changed. The server re-checks the merged route. */
export const journeyTemplateUpdateSchema = z.object(configFields).partial().strict().superRefine(checkRoute);
export type JourneyTemplateUpdate = z.input<typeof journeyTemplateUpdateSchema>;

// ── Journeys (instances) ────────────────────────────────────────────────

/**
 * Create a journey directly. Also accepts the Phase 3 draft payload
 * (`passengerIds`), so existing clients keep working.
 */
export const journeyCreateSchema = z
  .object({
    ...configFields,
    name: configFields.name.optional(),
    journeyDate: calendarDateSchema,
    boardingStationCode: configFields.boardingStationCode.default(null),
    quota: configFields.quota.default(JOURNEY_DEFAULTS.quota),
    passengers: configFields.passengers.optional(),
    passengerIds: z
      .array(z.uuid())
      .max(MAX_JOURNEY_PASSENGERS, "Too many passengers")
      .refine(unique, "A passenger is selected twice")
      .optional(),
    trains: configFields.trains.default([]),
    classes: configFields.classes.default([...DEFAULT_CLASS_PRIORITY]),
    anyTrainAllowed: configFields.anyTrainAllowed.default(JOURNEY_DEFAULTS.anyTrainAllowed),
    useNextAvailableClass: configFields.useNextAvailableClass.default(JOURNEY_DEFAULTS.useNextAvailableClass),
    considerAutoUpgradation: configFields.considerAutoUpgradation.default(JOURNEY_DEFAULTS.considerAutoUpgradation),
    racWaitlistPreference: configFields.racWaitlistPreference.default(JOURNEY_DEFAULTS.racWaitlistPreference),
  })
  .strict()
  .superRefine((v, ctx) => {
    checkRoute(v, ctx);
    if (v.passengers && v.passengerIds) {
      ctx.addIssue({ code: "custom", path: ["passengers"], message: "Send either passengers or passengerIds, not both" });
    }
    const count = v.passengers?.length ?? v.passengerIds?.length ?? 0;
    if (count === 0) ctx.addIssue({ code: "custom", path: [v.passengerIds ? "passengerIds" : "passengers"], message: "Select at least one passenger" });
  })
  .transform(({ passengerIds, ...rest }) =>
    normaliseBoarding({ ...rest, passengers: rest.passengers ?? (passengerIds ?? []).map((passengerId) => ({ passengerId })) }),
  );
export type JourneyCreateInput = z.input<typeof journeyCreateSchema>;

export const journeyUpdateSchema = z
  .object({ ...configFields, journeyDate: calendarDateSchema })
  .partial()
  .strict()
  .superRefine(checkRoute);
export type JourneyUpdate = z.input<typeof journeyUpdateSchema>;

export const journeyFromTemplateSchema = z.object({ journeyDate: calendarDateSchema, name: journeyNameSchema.optional() }).strict();
export type JourneyFromTemplateInput = z.input<typeof journeyFromTemplateSchema>;

export const journeyDuplicateSchema = z.object({ journeyDate: calendarDateSchema.optional(), name: journeyNameSchema.optional() }).strict();
export type JourneyDuplicateInput = z.input<typeof journeyDuplicateSchema>;

// ── Sub-resource payloads (shared by journeys and templates) ────────────

export const setPassengersSchema = z.object({ passengers: passengerListSchema }).strict();
export const addPassengerSchema = passengerSelectionSchema;
export const setTrainsSchema = z.object({ trains: trainListSchema }).strict();
export const addTrainSchema = z.object({ trainNumber: trainNumberSchema }).strict();
export const setClassesSchema = z.object({ classes: classListSchema }).strict();
export const addClassSchema = z.object({ classCode: classCodeSchema }).strict();

export const trainSearchQuerySchema = z.object({
  q: z.string().trim().min(1, "Type a train name or number").max(50),
  from: stationCodeSchema.optional(),
  to: stationCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

// ── Ordering helpers ────────────────────────────────────────────────────

/** Move one item to a new index, returning a new array. Out-of-range moves are no-ops. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Explicit 1-based priorities for an ordered list. */
export function withPriorities<T>(list: readonly T[]): Array<{ priority: number; item: T }> {
  return list.map((item, i) => ({ priority: i + 1, item }));
}
