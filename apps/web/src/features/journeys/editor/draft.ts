import {
  DEFAULT_CLASS_PRIORITY,
  JOURNEY_DEFAULTS,
  todayInIndia,
  type BerthPreference,
  type ClassCode,
  type JourneyConfigDto,
  type JourneyCreateInput,
  type JourneyDetailDto,
  type JourneyTemplateInput,
  type JourneyUpdate,
  type Quota,
  type RacWaitlistPreference,
  type StationDto,
} from "@tatkalflow/shared";

export type EditorMode = "journey" | "template";

export interface DraftTrain {
  trainNumber: string;
  trainName: string | null;
}

export interface DraftPassenger {
  passengerId: string;
  berthPreference: BerthPreference;
}

/** Everything the editor collects. Server DTOs map in and payloads map out. */
export interface Draft {
  name: string;
  from: StationDto | null;
  to: StationDto | null;
  boarding: StationDto | null;
  journeyDate: string;
  quota: Quota;
  trains: DraftTrain[];
  anyTrainAllowed: boolean;
  classes: ClassCode[];
  useNextAvailableClass: boolean;
  passengers: DraftPassenger[];
  considerAutoUpgradation: boolean;
  racWaitlistPreference: RacWaitlistPreference;
}

export const STEPS = [
  { id: "route", title: "Route" },
  { id: "trains", title: "Trains" },
  { id: "classes", title: "Class & quota" },
  { id: "passengers", title: "Passengers" },
  { id: "preferences", title: "Preferences" },
  { id: "review", title: "Review" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

export function emptyDraft(): Draft {
  return {
    name: "",
    from: null,
    to: null,
    boarding: null,
    journeyDate: "",
    quota: JOURNEY_DEFAULTS.quota,
    trains: [],
    anyTrainAllowed: JOURNEY_DEFAULTS.anyTrainAllowed,
    classes: [...DEFAULT_CLASS_PRIORITY],
    useNextAvailableClass: JOURNEY_DEFAULTS.useNextAvailableClass,
    passengers: [],
    considerAutoUpgradation: JOURNEY_DEFAULTS.considerAutoUpgradation,
    racWaitlistPreference: JOURNEY_DEFAULTS.racWaitlistPreference,
  };
}

const station = (code: string | null, name: string | null): StationDto | null => (code ? { code, name: name ?? code, state: null } : null);

export function draftFromConfig(c: JourneyConfigDto | JourneyDetailDto): Draft {
  return {
    name: c.name,
    from: station(c.fromStationCode, c.fromStationName),
    to: station(c.toStationCode, c.toStationName),
    boarding: station(c.boardingStationCode, c.boardingStationName),
    journeyDate: "journeyDate" in c ? c.journeyDate : "",
    quota: c.quota,
    // Removed passengers can't be re-saved onto a list; the editor leaves them out.
    passengers: c.passengers.filter((p) => !p.removed).map((p) => ({ passengerId: p.id, berthPreference: p.berthPreference })),
    trains: c.trains.map((t) => ({ trainNumber: t.trainNumber, trainName: t.trainName })),
    anyTrainAllowed: c.anyTrainAllowed,
    classes: c.classes.map((k) => k.classCode as ClassCode),
    useNextAvailableClass: c.useNextAvailableClass,
    considerAutoUpgradation: c.considerAutoUpgradation,
    racWaitlistPreference: c.racWaitlistPreference,
  };
}

export type DraftErrors = Partial<Record<"name" | "from" | "to" | "boarding" | "journeyDate" | "classes" | "passengers", string>>;

export interface StepContext {
  mode: EditorMode;
  today?: string;
  /** Configured passenger limit for the draft's quota (null when not configured). */
  passengerLimit: number | null;
}

/** Errors that block leaving a step. Optional preferences never block. */
export function validateStep(step: StepId, d: Draft, ctx: StepContext): DraftErrors {
  const e: DraftErrors = {};
  if (step === "route") {
    if (ctx.mode === "template" && !d.name.trim()) e.name = "Give this template a name";
    if (d.name.trim().length > 60) e.name = "Keep the name under 60 characters";
    if (!d.from) e.from = "Choose where you're travelling from";
    if (!d.to) e.to = "Choose your destination";
    if (d.from && d.to && d.from.code === d.to.code) e.to = "From and To must be different";
    if (d.boarding && d.to && d.boarding.code === d.to.code) e.boarding = "The boarding point can't be your destination";
    if (ctx.mode === "journey") {
      const today = ctx.today ?? todayInIndia();
      if (!d.journeyDate) e.journeyDate = "Choose a travel date";
      else if (d.journeyDate < today) e.journeyDate = "That date has passed";
    }
  }
  if (step === "classes" && d.classes.length === 0) e.classes = "Choose at least one class";
  if (step === "passengers") {
    if (ctx.mode === "journey" && d.passengers.length === 0) e.passengers = "Select at least one passenger";
    if (ctx.passengerLimit !== null && d.passengers.length > ctx.passengerLimit) {
      e.passengers = `At most ${ctx.passengerLimit} passenger${ctx.passengerLimit === 1 ? "" : "s"} per booking`;
    }
  }
  return e;
}

/** Which step shows a given server field error. */
export function stepForField(path: string): StepId {
  const head = path.split(".")[0] ?? "";
  if (["name", "fromStationCode", "toStationCode", "boardingStationCode", "journeyDate"].includes(head)) return "route";
  if (head === "trains" || head === "anyTrainAllowed") return "trains";
  if (head === "classes" || head === "quota" || head === "useNextAvailableClass") return "classes";
  if (head === "passengers" || head === "passengerIds") return "passengers";
  return "preferences";
}

export function draftErrorKey(path: string): keyof DraftErrors | null {
  const head = path.split(".")[0] ?? "";
  const map: Record<string, keyof DraftErrors> = {
    name: "name",
    fromStationCode: "from",
    toStationCode: "to",
    boardingStationCode: "boarding",
    journeyDate: "journeyDate",
    classes: "classes",
    passengers: "passengers",
    passengerIds: "passengers",
  };
  return map[head] ?? null;
}

function configPayload(d: Draft) {
  return {
    fromStationCode: d.from!.code,
    toStationCode: d.to!.code,
    boardingStationCode: d.boarding?.code ?? null,
    quota: d.quota,
    trains: d.trains.map((t) => t.trainNumber),
    anyTrainAllowed: d.anyTrainAllowed,
    classes: d.classes,
    useNextAvailableClass: d.useNextAvailableClass,
    passengers: d.passengers.map((p) => ({ passengerId: p.passengerId, berthPreference: p.berthPreference })),
    considerAutoUpgradation: d.considerAutoUpgradation,
    racWaitlistPreference: d.racWaitlistPreference,
  };
}

export function toJourneyCreate(d: Draft): JourneyCreateInput {
  return { ...configPayload(d), journeyDate: d.journeyDate, ...(d.name.trim() && { name: d.name.trim() }) };
}

export function toJourneyUpdate(d: Draft): JourneyUpdate {
  return { ...configPayload(d), journeyDate: d.journeyDate, ...(d.name.trim() && { name: d.name.trim() }) };
}

export function toTemplateInput(d: Draft): JourneyTemplateInput {
  return { ...configPayload(d), name: d.name.trim() };
}
