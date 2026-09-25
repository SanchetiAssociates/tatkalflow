import { isTatkalQuota, type Quota } from "../schemas/journey-config.js";
import type { RuleKey } from "../schemas/rules.js";
import { RULE_LABELS } from "./rule-snapshot.js";

/**
 * Booking-readiness preview (Phase 4 spec §16). A pure function: the API
 * gathers the facts, this decides. It only reports configuration; it never
 * books anything.
 *
 * - FAIL: something required is missing or invalid → NOT_READY.
 * - WARN: usable, but not certain (e.g. an unverified rule) → WARNING.
 * - PASS / INFO: fine / for information.
 * A journey is READY only when nothing FAILs or WARNs, so it can never be
 * READY while a rule it depends on is missing or unverified.
 */

export type ReadinessStatus = "PASS" | "WARN" | "FAIL" | "INFO";
export type ReadinessOverall = "READY" | "WARNING" | "NOT_READY";

export const READINESS_KEYS = [
  "route",
  "journey_date",
  "passengers",
  "passenger_details",
  "passenger_names",
  "passenger_count",
  "senior_concession",
  "irctc_account",
  "classes",
  "class_rules",
  "trains",
  "preferences",
  "rules_verified",
  "rules_changed",
] as const;
export type ReadinessKey = (typeof READINESS_KEYS)[number];

export interface ReadinessItem {
  key: ReadinessKey;
  status: ReadinessStatus;
  label: string;
  detail?: string;
}

export interface ReadinessReport {
  overall: ReadinessOverall;
  items: ReadinessItem[];
}

export const READINESS_LABELS: Record<ReadinessOverall, string> = {
  READY: "Ready",
  WARNING: "Needs attention",
  NOT_READY: "Not ready",
};

/** A rule as readiness sees it. `null` = not configured. */
export interface RuleFact<T = unknown> {
  value: T;
  isVerified: boolean;
  needsReverification?: boolean;
}

export interface ReadinessStation {
  code: string;
  /** False when the code is unknown or no longer in the active station list. */
  active: boolean;
}

export interface ReadinessInput {
  /** Today's date in India (YYYY-MM-DD). */
  today: string;
  /** Null for templates, which have no date. */
  journeyDate: string | null;
  from: ReadinessStation | null;
  to: ReadinessStation | null;
  boarding: ReadinessStation | null;
  quota: Quota;
  passengers: Array<{ name: string; removed: boolean; seniorCitizenOptIn: boolean }>;
  trains: Array<{ trainNumber: string; servesRoute: boolean | null }>;
  anyTrainAllowed: boolean;
  classes: string[];
  irctcLinked: boolean;
  rules: Partial<Record<RuleKey, RuleFact | null>>;
  /** Rules that changed since the journey's snapshot was taken. */
  rulesChangedSinceCreation?: string[];
}

/** The per-booking passenger limit rule for a quota. */
export function passengerLimitRuleKey(quota: Quota): RuleKey {
  return isTatkalQuota(quota) ? "tatkal.max_passengers_per_pnr" : "general.max_passengers_per_pnr";
}

/** Names count in characters (Unicode code points), after trimming. */
export function nameLength(name: string): number {
  return [...name.trim()].length;
}

/** Names longer than the rule allows. With no rule configured, nothing can be checked. */
export function namesOverLimit(names: readonly string[], maxLength: number | null): string[] {
  if (maxLength === null) return [];
  return names.filter((n) => nameLength(n) > maxLength);
}

export type SeniorConcession = "NOT_APPLICABLE" | "AVAILABLE" | "UNAVAILABLE";

/**
 * Senior-citizen concession on Tatkal. Fails closed: it is treated as
 * unavailable unless a VERIFIED rule says it is available.
 */
export function seniorConcessionOnQuota(quota: Quota, rule: RuleFact<boolean> | null | undefined): SeniorConcession {
  if (!isTatkalQuota(quota)) return "NOT_APPLICABLE";
  return rule && rule.isVerified && rule.value === true ? "AVAILABLE" : "UNAVAILABLE";
}

/** Tatkal classification of each chosen class, from the class-list rules. */
export function classTatkalCategory(classCode: string, rules: ReadinessInput["rules"]): "AC" | "NON_AC" | "UNKNOWN" {
  const ac = rules["tatkal.ac_classes"]?.value;
  const nonAc = rules["tatkal.non_ac_classes"]?.value;
  if (Array.isArray(ac) && ac.includes(classCode)) return "AC";
  if (Array.isArray(nonAc) && nonAc.includes(classCode)) return "NON_AC";
  return "UNKNOWN";
}

/** Rules this particular journey relies on. */
export function relevantRuleKeys(input: Pick<ReadinessInput, "quota" | "classes" | "passengers" | "rules">): RuleKey[] {
  const keys: RuleKey[] = [passengerLimitRuleKey(input.quota), "passenger.name_max_length"];
  if (isTatkalQuota(input.quota)) {
    keys.push("tatkal.advance_days", "tatkal.timezone", "tatkal.ac_classes");
    const categories = input.classes.map((c) => classTatkalCategory(c, input.rules));
    if (categories.includes("AC")) keys.push("tatkal.ac.opening_time");
    if (categories.includes("NON_AC")) keys.push("tatkal.non_ac.opening_time");
    if (categories.includes("NON_AC") || categories.includes("UNKNOWN")) keys.push("tatkal.non_ac_classes");
    if (input.passengers.some((p) => p.seniorCitizenOptIn)) keys.push("tatkal.senior_citizen_concession_available");
  }
  return [...new Set(keys)];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: readonly string[]) => xs.join(", ");

export function computeReadiness(input: ReadinessInput): ReadinessReport {
  const items: ReadinessItem[] = [];
  const add = (key: ReadinessKey, status: ReadinessStatus, label: string, detail?: string) =>
    items.push(detail === undefined ? { key, status, label } : { key, status, label, detail });

  // Route
  const routeProblems: string[] = [];
  if (!input.from) routeProblems.push("Choose where you're travelling from.");
  else if (!input.from.active) routeProblems.push(`${input.from.code} is not in the current station list.`);
  if (!input.to) routeProblems.push("Choose your destination.");
  else if (!input.to.active) routeProblems.push(`${input.to.code} is not in the current station list.`);
  if (input.from && input.to && input.from.code === input.to.code) routeProblems.push("From and To are the same station.");
  if (input.boarding && !input.boarding.active) routeProblems.push(`Boarding point ${input.boarding.code} is not in the current station list.`);
  if (routeProblems.length) add("route", "FAIL", "Route", routeProblems.join(" "));
  else add("route", "PASS", "Route", input.boarding ? `Boarding at ${input.boarding.code}.` : undefined);

  // Date (journeys only)
  if (input.journeyDate !== null) {
    if (input.journeyDate < input.today) add("journey_date", "FAIL", "Journey date", "This date has passed.");
    else add("journey_date", "PASS", "Journey date");
  }

  // Passengers
  const n = input.passengers.length;
  if (n === 0) add("passengers", "FAIL", "Passengers", "Add at least one passenger.");
  else add("passengers", "PASS", "Passengers", plural(n, "passenger"));

  const removed = input.passengers.filter((p) => p.removed).map((p) => p.name);
  if (removed.length) {
    add("passenger_details", "WARN", "Passenger details", `${list(removed)} ${removed.length === 1 ? "was" : "were"} removed from your saved passengers. Check this journey's passengers.`);
  } else if (n > 0) add("passenger_details", "PASS", "Passenger details");

  const nameRule = input.rules["passenger.name_max_length"] as RuleFact<number> | null | undefined;
  if (n > 0) {
    if (!nameRule) add("passenger_names", "WARN", "Passenger names", "The passenger-name length limit is not configured yet, so names could not be checked.");
    else {
      const long = namesOverLimit(input.passengers.map((p) => p.name), nameRule.value);
      if (long.length) add("passenger_names", "FAIL", "Passenger names", `Names can be at most ${nameRule.value} characters. Shorten: ${list(long)}.`);
      else add("passenger_names", "PASS", "Passenger names", `Within ${nameRule.value} characters.`);
    }
  }

  const limitKey = passengerLimitRuleKey(input.quota);
  const limitRule = input.rules[limitKey] as RuleFact<number> | null | undefined;
  if (!limitRule) {
    add(
      "passenger_count",
      "WARN",
      "Passengers per booking",
      isTatkalQuota(input.quota)
        ? "The Tatkal passenger limit per booking is not configured yet, so it could not be checked."
        : "The passenger limit per booking is not configured yet, so it could not be checked.",
    );
  } else if (n > limitRule.value) {
    add("passenger_count", "FAIL", "Passengers per booking", `At most ${limitRule.value} passengers per booking. Remove ${n - limitRule.value}.`);
  } else add("passenger_count", "PASS", "Passengers per booking", `${n} of at most ${limitRule.value}.`);

  const seniors = input.passengers.filter((p) => p.seniorCitizenOptIn);
  if (seniors.length && isTatkalQuota(input.quota)) {
    const concession = seniorConcessionOnQuota(input.quota, input.rules["tatkal.senior_citizen_concession_available"] as RuleFact<boolean> | null);
    if (concession === "UNAVAILABLE") {
      add(
        "senior_concession",
        "INFO",
        "Senior-citizen concession",
        `Senior-citizen concession isn't available on Tatkal bookings. ${list(seniors.map((p) => p.name))} will be booked at the normal Tatkal fare.`,
      );
    }
  }

  // IRCTC account (user ID only; TatkalFlow never holds the password)
  if (input.irctcLinked) add("irctc_account", "PASS", "IRCTC user ID");
  else add("irctc_account", "FAIL", "IRCTC user ID", "Add your IRCTC user ID in Profile. You'll still sign in on IRCTC yourself.");

  // Classes
  if (input.classes.length === 0) add("classes", "FAIL", "Class preference", "Choose at least one class.");
  else add("classes", "PASS", "Class preference", input.classes.join(" → "));

  if (isTatkalQuota(input.quota) && input.classes.length) {
    const unknown = input.classes.filter((c) => classTatkalCategory(c, input.rules) === "UNKNOWN");
    if (unknown.length) add("class_rules", "WARN", "Tatkal classes", `Tatkal rules for ${list(unknown)} aren't configured yet.`);
    else add("class_rules", "PASS", "Tatkal classes");
  }

  // Trains
  if (input.trains.length === 0 && !input.anyTrainAllowed) {
    add("trains", "FAIL", "Train preference", "Add at least one train, or allow any train on this route.");
  } else {
    const offRoute = input.trains.filter((t) => t.servesRoute === false).map((t) => t.trainNumber);
    if (offRoute.length) add("trains", "WARN", "Train preference", `Train ${list(offRoute)} isn't known to run between these stations.`);
    else add("trains", "PASS", "Train preference", input.trains.length ? plural(input.trains.length, "train") : "Any train on this route.");
  }

  // Quota, berth, RAC/waitlist and auto-upgrade always have a stored value (defaults apply).
  add("preferences", "PASS", "Journey preferences");

  // Railway rules this journey relies on
  const gaps = relevantRuleKeys(input).flatMap((key) => {
    const r = input.rules[key];
    if (!r) return [`${RULE_LABELS[key]} (not configured)`];
    if (!r.isVerified) return [`${RULE_LABELS[key]} (not verified)`];
    if (r.needsReverification) return [`${RULE_LABELS[key]} (due for re-verification)`];
    return [];
  });
  if (gaps.length) {
    add("rules_verified", "WARN", "Railway rules", `These rules have not been verified against an official source yet: ${list(gaps)}. Always confirm on IRCTC.`);
  } else add("rules_verified", "PASS", "Railway rules", "Verified.");

  if (input.rulesChangedSinceCreation?.length) {
    add(
      "rules_changed",
      "INFO",
      "Rule changes",
      `Rules changed since this journey was created: ${list(input.rulesChangedSinceCreation.map((k) => RULE_LABELS[k as RuleKey] ?? k))}. The checks above use the rules in force now.`,
    );
  }

  const overall: ReadinessOverall = items.some((i) => i.status === "FAIL")
    ? "NOT_READY"
    : items.some((i) => i.status === "WARN")
      ? "WARNING"
      : "READY";
  return { overall, items };
}
