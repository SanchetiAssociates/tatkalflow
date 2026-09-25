import type { ClassCode, Quota } from "../schemas/journey-config.js";
import type { RuleSnapshot } from "./rule-snapshot.js";

/**
 * CONTRACT ONLY (Phase 4 spec §17). No implementation exists yet, and nothing
 * in the app calls this. Phase 5 will implement it on top of
 * RailwayRulesService. Until then TatkalFlow shows no opening dates or times.
 *
 * An implementation must take every value (timezone, advance days, opening
 * times, class categories) from verified railway rules and must never fall
 * back to hard-coded values.
 */
export interface TatkalOpeningRequest {
  /** Journey date at the boarding station (YYYY-MM-DD). */
  journeyDate: string;
  quota: Quota;
  classCode: ClassCode;
}

export type TatkalOpeningResult =
  | {
      status: "OK";
      /** Opening instant (ISO 8601, UTC). */
      opensAt: string;
      /** Rule versions used, for the journey's audit trail. */
      ruleSnapshot: RuleSnapshot;
    }
  | {
      status: "UNAVAILABLE";
      reason: "RULE_MISSING" | "RULE_UNVERIFIED" | "CLASS_NOT_COVERED" | "QUOTA_NOT_TATKAL";
      ruleKeys: string[];
    };

export interface TatkalDateEngine {
  openingFor(request: TatkalOpeningRequest): Promise<TatkalOpeningResult>;
}
