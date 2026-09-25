import type { ClassCode, Quota, RacWaitlistPreference } from "../schemas/journey-config.js";
import type { BerthPreference, Gender } from "../schemas/passenger.js";
import type { RuleVerificationStatus } from "../schemas/rules.js";
import type { ReadinessOverall, ReadinessReport } from "./readiness.js";
import type { RuleSnapshot } from "./rule-snapshot.js";

/** A train as described by a TrainDataProvider. */
export interface TrainDto {
  number: string;
  name: string;
  fromStationCode: string;
  toStationCode: string;
  /** Station codes the train is known to call at, in order (including both ends). */
  stops: string[];
  classes: string[];
}

export interface TrainSearchResult {
  /** Which provider answered ("mock" in development). */
  provider: string;
  /** False when no train data source is configured. */
  available: boolean;
  results: TrainDto[];
}

export interface JourneyPassengerDto {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  /** Berth for this journey (copied from the passenger when added). */
  berthPreference: BerthPreference;
  seniorCitizenOptIn: boolean;
  /** The passenger was later removed from the saved list; this journey keeps them. */
  removed: boolean;
}

export interface JourneyTrainDto {
  priority: number;
  trainNumber: string;
  trainName: string | null;
}

export interface JourneyClassDto {
  priority: number;
  classCode: string;
}

/** Configuration shared by templates and journeys. */
export interface JourneyConfigDto {
  id: string;
  name: string;
  fromStationCode: string;
  fromStationName: string | null;
  toStationCode: string;
  toStationName: string | null;
  boardingStationCode: string | null;
  boardingStationName: string | null;
  quota: Quota;
  passengers: JourneyPassengerDto[];
  trains: JourneyTrainDto[];
  classes: JourneyClassDto[];
  anyTrainAllowed: boolean;
  useNextAvailableClass: boolean;
  considerAutoUpgradation: boolean;
  racWaitlistPreference: RacWaitlistPreference;
  createdAt: string;
  updatedAt: string;
}

export type JourneyTemplateDto = JourneyConfigDto;

export interface JourneyDto extends JourneyConfigDto {
  journeyDate: string;
  state: string;
  templateId: string | null;
  readinessStatus: ReadinessOverall;
}

export interface JourneyDetailDto extends JourneyDto {
  readiness: ReadinessReport;
  /** Rule versions in force when the journey was created (null for older journeys). */
  ruleSnapshot: RuleSnapshot | null;
}

export interface RuleInfoDto {
  ruleKey: string;
  label: string;
  value: unknown;
  verificationStatus: RuleVerificationStatus | "MISSING";
  isVerified: boolean;
}

/** Everything the journey editor needs, so the UI hard-codes no railway rules. */
export interface JourneyOptionsDto {
  classes: Array<{ code: ClassCode; name: string; tatkalCategory: "AC" | "NON_AC" | "UNKNOWN" }>;
  defaultClassPriority: ClassCode[];
  quotas: Array<{ value: Quota; label: string }>;
  racWaitlistPreferences: Array<{ value: RacWaitlistPreference; label: string; description: string }>;
  defaults: {
    quota: Quota;
    anyTrainAllowed: boolean;
    useNextAvailableClass: boolean;
    considerAutoUpgradation: boolean;
    racWaitlistPreference: RacWaitlistPreference;
  };
  maxPreferredTrains: number;
  /** Rule-driven limits, with their verification state. */
  rules: {
    passengerLimit: Record<Quota, RuleInfoDto>;
    nameMaxLength: RuleInfoDto;
    seniorConcessionOnTatkal: RuleInfoDto & { concession: "AVAILABLE" | "UNAVAILABLE" };
  };
  trainData: { provider: string; available: boolean };
}
