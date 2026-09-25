import {
  buildRuleSnapshot,
  changedRuleKeys,
  computeReadiness,
  isTatkalQuota,
  JOURNEY_RULE_KEYS,
  passengerLimitRuleKey,
  ruleSnapshotSchema,
  todayInIndia,
  type BerthPreference,
  type JourneyConfigDto,
  type JourneyDetailDto,
  type JourneyDto,
  type PassengerSelection,
  type Quota,
  type ReadinessInput,
  type ReadinessReport,
  type RuleKey,
  type RuleSnapshot,
  type TrainDto,
} from "@tatkalflow/shared";
import type { Db, Prisma } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { AppError, Errors } from "../../lib/errors.js";
import type { RailwayRulesService, ResolvedRule } from "../rules/railway-rules.service.js";
import type { StationService } from "../stations/station.service.js";
import { servesRoute, type TrainDataProvider } from "../trains/train-provider.js";

// ── Row shapes ──────────────────────────────────────────────────────────

const passengerSelect = { id: true, name: true, age: true, gender: true, seniorCitizenOptIn: true, deletedAt: true } as const;

export const journeyInclude = {
  passengers: { orderBy: { position: "asc" }, include: { passenger: { select: passengerSelect } } },
  trainPreferences: { orderBy: { priority: "asc" } },
  classPreferences: { orderBy: { priority: "asc" } },
} satisfies Prisma.JourneyInclude;
export type JourneyRow = Prisma.JourneyGetPayload<{ include: typeof journeyInclude }>;

export const templateInclude = {
  passengers: { orderBy: { position: "asc" }, include: { passenger: { select: passengerSelect } } },
  trains: { orderBy: { priority: "asc" } },
  classes: { orderBy: { priority: "asc" } },
} satisfies Prisma.JourneyTemplateInclude;
export type TemplateRow = Prisma.JourneyTemplateGetPayload<{ include: typeof templateInclude }>;

/** The configuration both kinds share, in one shape. */
export interface ConfigRow {
  id: string;
  name: string | null;
  fromStationCode: string;
  toStationCode: string;
  boardingStationCode: string | null;
  quota: Quota;
  anyTrainAllowed: boolean;
  useNextAvailableClass: boolean;
  considerAutoUpgradation: boolean;
  racWaitlistPreference: JourneyConfigDto["racWaitlistPreference"];
  createdAt: Date;
  updatedAt: Date;
  passengers: Array<{ berthPreference: BerthPreference; passenger: Prisma.PassengerGetPayload<{ select: typeof passengerSelect }> }>;
  trains: Array<{ priority: number; trainNumber: string; trainName: string | null }>;
  classes: Array<{ priority: number; classCode: string }>;
}

export const journeyConfig = (j: JourneyRow): ConfigRow => ({ ...j, trains: j.trainPreferences, classes: j.classPreferences });
export const templateConfig = (t: TemplateRow): ConfigRow => t;

/** Validated list rows, ready to write. */
export interface PassengerRow {
  passengerId: string;
  berthPreference: BerthPreference;
}
export interface TrainRow {
  trainNumber: string;
  trainName: string | null;
}

type Tx = Prisma.TransactionClient;

interface StationInfo {
  name: string;
  isActive: boolean;
}

/** Everything readiness needs that is the same for all of one user's journeys. */
export interface ReadinessContext {
  today: string;
  irctcLinked: boolean;
  rules: Partial<Record<RuleKey, ResolvedRule>>;
  currentSnapshot: RuleSnapshot;
}

export function editableOrThrow(state: string): void {
  // Only drafts can be edited in Phase 4; later states belong to the booking flow.
  if (state !== "DRAFT") throw new AppError(409, "JOURNEY_NOT_EDITABLE", "This journey can no longer be changed.");
}

/**
 * Journey and journey-template logic shared by the routes. Every method that
 * reads or writes user data takes the authenticated user's ID and scopes by
 * it; nothing here accepts a user ID from a request body.
 */
export class JourneyService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly rules: RailwayRulesService,
    private readonly stations: StationService,
    readonly trains: TrainDataProvider,
  ) {}

  today(): string {
    return todayInIndia(this.clock.now());
  }

  // ── Validation ───────────────────────────────────────────────────────

  assertNotPast(journeyDate: string): void {
    if (journeyDate < this.today()) {
      throw new AppError(400, "VALIDATION_ERROR", "Some details need attention.", {
        fields: [{ path: "journeyDate", message: "Journey date is in the past" }],
      });
    }
  }

  /** The merged route must still make sense after a partial update. */
  normaliseRoute(r: { fromStationCode: string; toStationCode: string; boardingStationCode: string | null }) {
    const fields: Array<{ path: string; message: string }> = [];
    if (r.fromStationCode === r.toStationCode) fields.push({ path: "toStationCode", message: "From and To must be different" });
    if (r.boardingStationCode && r.boardingStationCode === r.toStationCode) {
      fields.push({ path: "boardingStationCode", message: "The boarding point can't be your destination" });
    }
    if (fields.length) throw new AppError(400, "VALIDATION_ERROR", "Some details need attention.", { fields });
    return { ...r, boardingStationCode: r.boardingStationCode === r.fromStationCode ? null : r.boardingStationCode };
  }

  async requireStations(codes: Array<string | null | undefined>): Promise<void> {
    const list = [...new Set(codes.filter((c): c is string => Boolean(c)))];
    if (list.length) await this.stations.requireActive(list);
  }

  /** Every passenger must be this user's and not deleted. Others' IDs look like unknown IDs. */
  async resolvePassengers(userId: string, selections: PassengerSelection[]): Promise<PassengerRow[]> {
    if (!selections.length) return [];
    const ids = selections.map((s) => s.passengerId);
    const owned = await this.db.passenger.findMany({ where: { id: { in: ids }, userId, deletedAt: null }, select: { id: true, berthPreference: true } });
    if (owned.length !== new Set(ids).size) throw Errors.notFound("One or more passengers were not found.");
    const saved = new Map(owned.map((p) => [p.id, p.berthPreference]));
    return selections.map((s) => ({ passengerId: s.passengerId, berthPreference: s.berthPreference ?? saved.get(s.passengerId)! }));
  }

  /** Train names come from the provider, never from the client. */
  async resolveTrains(numbers: string[]): Promise<TrainRow[]> {
    const found = await Promise.all(numbers.map((n) => this.trains.findByNumber(n)));
    if (this.trains.authoritative) {
      const unknown = numbers.filter((_, i) => !found[i]);
      if (unknown.length) throw new AppError(400, "UNKNOWN_TRAIN", "Choose trains from the list.", { trainNumbers: unknown });
    }
    return numbers.map((trainNumber, i) => ({ trainNumber, trainName: found[i]?.name ?? null }));
  }

  /**
   * The per-booking passenger limit comes from RailwayRulesService. When a
   * limit is configured it is enforced (verified or not; readiness says which).
   * When none is configured nothing can be checked, and readiness warns.
   */
  async assertPassengerLimit(quota: Quota, count: number): Promise<void> {
    const limit = await this.rules.find(passengerLimitRuleKey(quota));
    if (limit && count > (limit.value as number)) {
      const who = isTatkalQuota(quota) ? "Tatkal bookings allow" : "Bookings allow";
      throw new AppError(400, "TOO_MANY_PASSENGERS", `${who} up to ${limit.value} passengers per booking.`, { max: limit.value });
    }
  }

  // ── List writers (replace-all keeps priorities dense and unique) ────────

  async writeJourneyLists(tx: Tx, journeyId: string, lists: { passengers?: PassengerRow[]; trains?: TrainRow[]; classes?: string[] }) {
    if (lists.passengers) {
      await tx.journeyPassenger.deleteMany({ where: { journeyId } });
      await tx.journeyPassenger.createMany({ data: lists.passengers.map((p, position) => ({ journeyId, position, ...p })) });
    }
    if (lists.trains) {
      await tx.journeyTrainPreference.deleteMany({ where: { journeyId } });
      await tx.journeyTrainPreference.createMany({ data: lists.trains.map((t, i) => ({ journeyId, priority: i + 1, ...t })) });
    }
    if (lists.classes) {
      await tx.journeyClassPreference.deleteMany({ where: { journeyId } });
      await tx.journeyClassPreference.createMany({ data: lists.classes.map((classCode, i) => ({ journeyId, priority: i + 1, classCode })) });
    }
  }

  async writeTemplateLists(tx: Tx, templateId: string, lists: { passengers?: PassengerRow[]; trains?: TrainRow[]; classes?: string[] }) {
    if (lists.passengers) {
      await tx.journeyTemplatePassenger.deleteMany({ where: { templateId } });
      await tx.journeyTemplatePassenger.createMany({ data: lists.passengers.map((p, position) => ({ templateId, position, ...p })) });
    }
    if (lists.trains) {
      await tx.journeyTemplateTrain.deleteMany({ where: { templateId } });
      await tx.journeyTemplateTrain.createMany({ data: lists.trains.map((t, i) => ({ templateId, priority: i + 1, ...t })) });
    }
    if (lists.classes) {
      await tx.journeyTemplateClass.deleteMany({ where: { templateId } });
      await tx.journeyTemplateClass.createMany({ data: lists.classes.map((classCode, i) => ({ templateId, priority: i + 1, classCode })) });
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────

  async findJourney(userId: string, id: string): Promise<JourneyRow> {
    const j = await this.db.journey.findFirst({ where: { id, userId, deletedAt: null }, include: journeyInclude });
    if (!j) throw Errors.notFound("Journey not found.");
    return j;
  }

  async findTemplate(userId: string, id: string): Promise<TemplateRow> {
    const t = await this.db.journeyTemplate.findFirst({ where: { id, userId, deletedAt: null }, include: templateInclude });
    if (!t) throw Errors.notFound("Template not found.");
    return t;
  }

  async stationInfo(codes: Array<string | null>): Promise<Map<string, StationInfo>> {
    const list = [...new Set(codes.filter((c): c is string => Boolean(c)))];
    const rows = await this.db.station.findMany({ where: { code: { in: list } }, select: { code: true, name: true, isActive: true } });
    return new Map(rows.map((r) => [r.code, { name: r.name, isActive: r.isActive }]));
  }

  // ── Rules ────────────────────────────────────────────────────────────

  async ruleSnapshotNow(): Promise<RuleSnapshot> {
    return buildRuleSnapshot(this.clock.now(), await this.rules.snapshot(), JOURNEY_RULE_KEYS);
  }

  async readinessContext(userId: string): Promise<ReadinessContext> {
    const now = this.clock.now();
    const [rules, irctc] = await Promise.all([this.rules.snapshot(now), this.db.irctcAccount.findFirst({ where: { userId, deletedAt: null }, select: { id: true } })]);
    return { today: todayInIndia(now), irctcLinked: Boolean(irctc), rules, currentSnapshot: buildRuleSnapshot(now, rules, JOURNEY_RULE_KEYS) };
  }

  async readiness(config: ConfigRow, journeyDate: string | null, snapshotJson: unknown, ctx: ReadinessContext, stations: Map<string, StationInfo>): Promise<ReadinessReport> {
    const station = (code: string | null) => (code ? { code, active: stations.get(code)?.isActive ?? false } : null);
    const boardAt = config.boardingStationCode ?? config.fromStationCode;
    const trains = await Promise.all(
      config.trains.map(async (t) => ({ trainNumber: t.trainNumber, servesRoute: servesRoute(await this.trains.findByNumber(t.trainNumber), boardAt, config.toStationCode) })),
    );
    const snapshot = ruleSnapshotSchema.safeParse(snapshotJson);
    const input: ReadinessInput = {
      today: ctx.today,
      journeyDate,
      from: station(config.fromStationCode),
      to: station(config.toStationCode),
      boarding: station(config.boardingStationCode),
      quota: config.quota,
      passengers: config.passengers.map((p) => ({ name: p.passenger.name, removed: p.passenger.deletedAt !== null, seniorCitizenOptIn: p.passenger.seniorCitizenOptIn })),
      trains,
      anyTrainAllowed: config.anyTrainAllowed,
      classes: config.classes.map((c) => c.classCode),
      irctcLinked: ctx.irctcLinked,
      rules: Object.fromEntries(
        Object.entries(ctx.rules).map(([k, r]) => [k, { value: r.value, isVerified: r.isVerified, needsReverification: r.needsReverification }]),
      ),
      rulesChangedSinceCreation: snapshot.success ? changedRuleKeys(snapshot.data, ctx.currentSnapshot) : [],
    };
    return computeReadiness(input);
  }

  // ── DTOs ─────────────────────────────────────────────────────────────

  configDto(c: ConfigRow, stations: Map<string, StationInfo>): JourneyConfigDto {
    return {
      id: c.id,
      name: c.name ?? `${c.fromStationCode} → ${c.toStationCode}`,
      fromStationCode: c.fromStationCode,
      fromStationName: stations.get(c.fromStationCode)?.name ?? null,
      toStationCode: c.toStationCode,
      toStationName: stations.get(c.toStationCode)?.name ?? null,
      boardingStationCode: c.boardingStationCode,
      boardingStationName: c.boardingStationCode ? (stations.get(c.boardingStationCode)?.name ?? null) : null,
      quota: c.quota,
      passengers: c.passengers.map((p) => ({
        id: p.passenger.id,
        name: p.passenger.name,
        age: p.passenger.age,
        gender: p.passenger.gender,
        berthPreference: p.berthPreference,
        seniorCitizenOptIn: p.passenger.seniorCitizenOptIn,
        removed: p.passenger.deletedAt !== null,
      })),
      trains: c.trains.map((t) => ({ priority: t.priority, trainNumber: t.trainNumber, trainName: t.trainName })),
      classes: c.classes.map((k) => ({ priority: k.priority, classCode: k.classCode })),
      anyTrainAllowed: c.anyTrainAllowed,
      useNextAvailableClass: c.useNextAvailableClass,
      considerAutoUpgradation: c.considerAutoUpgradation,
      racWaitlistPreference: c.racWaitlistPreference,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  async journeyDtos(userId: string, rows: JourneyRow[]): Promise<JourneyDto[]> {
    const ctx = await this.readinessContext(userId);
    const stations = await this.stationInfo(rows.flatMap((j) => [j.fromStationCode, j.toStationCode, j.boardingStationCode]));
    return Promise.all(
      rows.map(async (j) => {
        const cfg = journeyConfig(j);
        const readiness = await this.readiness(cfg, ymd(j.journeyDate), j.ruleSnapshot, ctx, stations);
        return { ...this.configDto(cfg, stations), journeyDate: ymd(j.journeyDate), state: j.state, templateId: j.templateId, readinessStatus: readiness.overall };
      }),
    );
  }

  async journeyDetail(userId: string, id: string): Promise<JourneyDetailDto> {
    const j = await this.findJourney(userId, id);
    const [ctx, stations] = await Promise.all([this.readinessContext(userId), this.stationInfo([j.fromStationCode, j.toStationCode, j.boardingStationCode])]);
    const cfg = journeyConfig(j);
    const readiness = await this.readiness(cfg, ymd(j.journeyDate), j.ruleSnapshot, ctx, stations);
    const snapshot = ruleSnapshotSchema.safeParse(j.ruleSnapshot);
    return {
      ...this.configDto(cfg, stations),
      journeyDate: ymd(j.journeyDate),
      state: j.state,
      templateId: j.templateId,
      readinessStatus: readiness.overall,
      readiness,
      ruleSnapshot: snapshot.success ? snapshot.data : null,
    };
  }

  async templateDto(userId: string, id: string): Promise<JourneyConfigDto> {
    const t = await this.findTemplate(userId, id);
    return this.configDto(templateConfig(t), await this.stationInfo([t.fromStationCode, t.toStationCode, t.boardingStationCode]));
  }

  /** A readable default name from the route. */
  async defaultName(from: string, to: string): Promise<string> {
    const info = await this.stationInfo([from, to]);
    const long = `${info.get(from)?.name ?? from} to ${info.get(to)?.name ?? to}`;
    return long.length <= 60 ? long : `${from} → ${to}`;
  }

  async trainLookup(number: string): Promise<TrainDto | null> {
    return this.trains.findByNumber(number);
  }
}

export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const dateOf = (ymdStr: string) => new Date(`${ymdStr}T00:00:00.000Z`);
