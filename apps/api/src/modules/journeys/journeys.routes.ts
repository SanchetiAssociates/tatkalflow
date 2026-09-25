import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  DEFAULT_CLASS_PRIORITY,
  JOURNEY_DEFAULTS,
  journeyCreateSchema,
  journeyDuplicateSchema,
  journeyUpdateSchema,
  MAX_PREFERRED_TRAINS,
  passengerLimitRuleKey,
  QUOTA_LABELS,
  QUOTAS,
  RAC_WAITLIST_DESCRIPTIONS,
  RAC_WAITLIST_LABELS,
  RAC_WAITLIST_PREFERENCES,
  RULE_LABELS,
  seniorConcessionOnQuota,
  TRAVEL_CLASSES,
  classTatkalCategory,
  type JourneyDetailDto,
  type JourneyOptionsDto,
  type Quota,
  type RuleInfoDto,
  type RuleKey,
} from "@tatkalflow/shared";
import type { AppContainer } from "../../container.js";
import type { Prisma } from "../../db.js";
import { AppError, Errors } from "../../lib/errors.js";
import { parseIdParam } from "../../http/params.js";
import { authenticate, requestContext, requireAuth } from "../../http/request-context.js";
import { AuditActions, type AuditAction } from "../audit/audit.service.js";
import type { ResolvedRule } from "../rules/railway-rules.service.js";
import { registerConfigListRoutes } from "./config-lists.routes.js";
import { dateOf, editableOrThrow, journeyInclude, ymd, type PassengerRow, type TrainRow } from "./journey.service.js";

/** Warnings in the create/duplicate response: the readiness items that need attention. */
const warningsOf = (j: JourneyDetailDto) => j.readiness.items.filter((i) => i.status === "WARN" && i.detail).map((i) => i.detail!);

function ruleInfo(key: RuleKey, r: ResolvedRule | undefined): RuleInfoDto {
  return { ruleKey: key, label: RULE_LABELS[key], value: r?.value ?? null, verificationStatus: r?.verificationStatus ?? "MISSING", isVerified: r?.isVerified ?? false };
}

/**
 * Journeys (instances): a concrete, dated journey. Every query is scoped by
 * the authenticated user; another user's journey is indistinguishable from a
 * missing one (404).
 */
export async function journeyRoutes(app: FastifyInstance, c: AppContainer) {
  const auth = { preHandler: authenticate(c.tokens) };
  const svc = c.journeys;

  function audit(request: FastifyRequest, action: AuditAction, userId: string, id: string, metadata: Record<string, unknown> = {}) {
    const ctx = requestContext(request, c.config);
    // IDs, counts and field names only — no names, ages or train choices.
    return c.audit.record({ action, userId, entityType: "journey", entityId: id, metadata, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  }

  /** Creates a DRAFT journey with a rule snapshot. Inputs must already be validated and owned. */
  async function createJourney(
    userId: string,
    data: Omit<Prisma.JourneyUncheckedCreateInput, "userId" | "state" | "ruleSnapshot">,
    lists: { passengers: PassengerRow[]; trains: TrainRow[]; classes: string[] },
  ) {
    const snapshot = await svc.ruleSnapshotNow();
    const now = c.clock.now();
    return c.db.$transaction(async (tx) => {
      const j = await tx.journey.create({ data: { ...data, userId, state: "DRAFT", ruleSnapshot: snapshot as Prisma.InputJsonValue } });
      await svc.writeJourneyLists(tx, j.id, lists);
      const ids = lists.passengers.map((p) => p.passengerId);
      if (ids.length) await tx.passenger.updateMany({ where: { id: { in: ids }, userId }, data: { lastUsedAt: now } });
      await c.stations.recordUse(userId, [data.fromStationCode, data.toStationCode], tx);
      return j;
    });
  }

  // ── Options: reference data and rule-driven limits for the editor ─────

  app.get("/api/journey-options", auth, async (): Promise<JourneyOptionsDto> => {
    const rules = await c.rules.snapshot();
    const facts = Object.fromEntries(Object.entries(rules).map(([k, r]) => [k, { value: r.value, isVerified: r.isVerified }]));
    const concession = rules["tatkal.senior_citizen_concession_available"];
    return {
      classes: TRAVEL_CLASSES.map((k) => ({ code: k.code, name: k.name, tatkalCategory: classTatkalCategory(k.code, facts) })),
      defaultClassPriority: [...DEFAULT_CLASS_PRIORITY],
      quotas: QUOTAS.map((q) => ({ value: q, label: QUOTA_LABELS[q] })),
      racWaitlistPreferences: RAC_WAITLIST_PREFERENCES.map((v) => ({ value: v, label: RAC_WAITLIST_LABELS[v], description: RAC_WAITLIST_DESCRIPTIONS[v] })),
      defaults: { ...JOURNEY_DEFAULTS },
      maxPreferredTrains: MAX_PREFERRED_TRAINS,
      rules: {
        passengerLimit: Object.fromEntries(QUOTAS.map((q) => [q, ruleInfo(passengerLimitRuleKey(q), rules[passengerLimitRuleKey(q)])])) as Record<Quota, RuleInfoDto>,
        nameMaxLength: ruleInfo("passenger.name_max_length", rules["passenger.name_max_length"]),
        seniorConcessionOnTatkal: {
          ...ruleInfo("tatkal.senior_citizen_concession_available", concession),
          concession: seniorConcessionOnQuota("TATKAL", concession ? { value: concession.value as boolean, isVerified: concession.isVerified } : null) === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE",
        },
      },
      trainData: { provider: svc.trains.name, available: svc.trains.available },
    };
  });

  // ── Journeys ───────────────────────────────────────────────────────────

  app.get("/api/journeys", auth, async (request) => {
    const { userId } = requireAuth(request);
    const rows = await c.db.journey.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ journeyDate: "asc" }, { createdAt: "asc" }],
      include: journeyInclude,
    });
    return svc.journeyDtos(userId, rows);
  });

  app.get("/api/journeys/:id", auth, async (request) => {
    const { userId } = requireAuth(request);
    return svc.journeyDetail(userId, parseIdParam(request.params));
  });

  app.get("/api/journeys/:id/readiness", auth, async (request) => {
    const { userId } = requireAuth(request);
    const j = await svc.journeyDetail(userId, parseIdParam(request.params));
    return j.readiness;
  });

  app.post("/api/journeys", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const input = journeyCreateSchema.parse(request.body);
    svc.assertNotPast(input.journeyDate);
    await svc.requireStations([input.fromStationCode, input.toStationCode, input.boardingStationCode]);
    const passengers = await svc.resolvePassengers(userId, input.passengers);
    await svc.assertPassengerLimit(input.quota, passengers.length);
    const trains = await svc.resolveTrains(input.trains);

    const journey = await createJourney(
      userId,
      {
        name: input.name ?? (await svc.defaultName(input.fromStationCode, input.toStationCode)),
        fromStationCode: input.fromStationCode,
        toStationCode: input.toStationCode,
        boardingStationCode: input.boardingStationCode,
        journeyDate: dateOf(input.journeyDate),
        quota: input.quota,
        anyTrainAllowed: input.anyTrainAllowed,
        useNextAvailableClass: input.useNextAvailableClass,
        considerAutoUpgradation: input.considerAutoUpgradation,
        racWaitlistPreference: input.racWaitlistPreference,
      },
      { passengers, trains, classes: input.classes },
    );
    await audit(request, AuditActions.JOURNEY_CREATED, userId, journey.id, {
      state: "DRAFT",
      passengerCount: passengers.length,
      trainCount: trains.length,
      classCount: input.classes.length,
    });
    const detail = await svc.journeyDetail(userId, journey.id);
    return reply.code(201).send({ journey: detail, warnings: warningsOf(detail) });
  });

  app.patch("/api/journeys/:id", auth, async (request) => {
    const { userId } = requireAuth(request);
    const id = parseIdParam(request.params);
    const input = journeyUpdateSchema.parse(request.body);
    const j = await svc.findJourney(userId, id);
    editableOrThrow(j.state);

    if (input.journeyDate) svc.assertNotPast(input.journeyDate);
    const route = svc.normaliseRoute({
      fromStationCode: input.fromStationCode ?? j.fromStationCode,
      toStationCode: input.toStationCode ?? j.toStationCode,
      boardingStationCode: input.boardingStationCode !== undefined ? input.boardingStationCode : j.boardingStationCode,
    });
    await svc.requireStations([input.fromStationCode, input.toStationCode, input.boardingStationCode]);
    const passengers = input.passengers ? await svc.resolvePassengers(userId, input.passengers) : undefined;
    const quota = input.quota ?? j.quota;
    if (input.passengers || input.quota) await svc.assertPassengerLimit(quota, passengers?.length ?? j.passengers.length);
    const trains = input.trains ? await svc.resolveTrains(input.trains) : undefined;

    await c.db.$transaction(async (tx) => {
      const res = await tx.journey.updateMany({
        where: { id, userId, deletedAt: null, state: "DRAFT" },
        data: {
          ...route,
          ...(input.name !== undefined && { name: input.name }),
          ...(input.journeyDate !== undefined && { journeyDate: dateOf(input.journeyDate) }),
          quota,
          ...(input.anyTrainAllowed !== undefined && { anyTrainAllowed: input.anyTrainAllowed }),
          ...(input.useNextAvailableClass !== undefined && { useNextAvailableClass: input.useNextAvailableClass }),
          ...(input.considerAutoUpgradation !== undefined && { considerAutoUpgradation: input.considerAutoUpgradation }),
          ...(input.racWaitlistPreference !== undefined && { racWaitlistPreference: input.racWaitlistPreference }),
        },
      });
      if (res.count !== 1) throw Errors.notFound("Journey not found.");
      await svc.writeJourneyLists(tx, id, { ...(passengers && { passengers }), ...(trains && { trains }), ...(input.classes && { classes: input.classes }) });
    });
    await audit(request, AuditActions.JOURNEY_UPDATED, userId, id, { fields: Object.keys(input) });
    return svc.journeyDetail(userId, id);
  });

  app.post("/api/journeys/:id/duplicate", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const id = parseIdParam(request.params);
    const input = journeyDuplicateSchema.parse(request.body ?? {});
    const src = await svc.findJourney(userId, id);

    const journeyDate = input.journeyDate ?? ymd(src.journeyDate);
    if (!input.journeyDate && journeyDate < svc.today()) {
      throw new AppError(400, "VALIDATION_ERROR", "Some details need attention.", {
        fields: [{ path: "journeyDate", message: "The original date has passed. Choose a new date." }],
      });
    }
    svc.assertNotPast(journeyDate);
    // Passengers since removed from the saved list are not carried over.
    const kept = src.passengers.filter((p) => p.passenger.deletedAt === null);
    await svc.assertPassengerLimit(src.quota, kept.length);
    const srcName = src.name ?? `${src.fromStationCode} → ${src.toStationCode}`;

    const copy = await createJourney(
      userId,
      {
        name: input.name ?? `Copy of ${srcName}`.slice(0, 60).trim(),
        templateId: src.templateId,
        fromStationCode: src.fromStationCode,
        toStationCode: src.toStationCode,
        boardingStationCode: src.boardingStationCode,
        journeyDate: dateOf(journeyDate),
        quota: src.quota,
        anyTrainAllowed: src.anyTrainAllowed,
        useNextAvailableClass: src.useNextAvailableClass,
        considerAutoUpgradation: src.considerAutoUpgradation,
        racWaitlistPreference: src.racWaitlistPreference,
        preferences: src.preferences as Prisma.InputJsonValue,
      },
      {
        passengers: kept.map((p) => ({ passengerId: p.passengerId, berthPreference: p.berthPreference })),
        trains: src.trainPreferences.map((t) => ({ trainNumber: t.trainNumber, trainName: t.trainName })),
        classes: src.classPreferences.map((k) => k.classCode),
      },
    );
    await audit(request, AuditActions.JOURNEY_DUPLICATED, userId, copy.id, { sourceJourneyId: id, passengerCount: kept.length });
    const detail = await svc.journeyDetail(userId, copy.id);
    const skipped = src.passengers.length - kept.length;
    const warnings = skipped ? [`${skipped} passenger${skipped === 1 ? " was" : "s were"} left out because they were removed from your saved passengers.`] : [];
    return reply.code(201).send({ journey: detail, warnings: [...warnings, ...warningsOf(detail)] });
  });

  app.delete("/api/journeys/:id", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const id = parseIdParam(request.params);
    const res = await c.db.journey.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: c.clock.now() } });
    if (res.count !== 1) throw Errors.notFound("Journey not found.");
    await audit(request, AuditActions.JOURNEY_DELETED, userId, id);
    return reply.code(204).send();
  });

  registerConfigListRoutes(app, c, {
    basePath: "/api/journeys",
    async load(userId, id) {
      const j = await svc.findJourney(userId, id);
      editableOrThrow(j.state);
      return {
        quota: j.quota,
        passengers: j.passengers.map((p) => ({ passengerId: p.passengerId, berthPreference: p.berthPreference })),
        trains: j.trainPreferences.map((t) => ({ trainNumber: t.trainNumber, trainName: t.trainName })),
        classes: j.classPreferences.map((k) => k.classCode),
      };
    },
    async write(tx, userId, id, lists) {
      const res = await tx.journey.updateMany({ where: { id, userId, deletedAt: null, state: "DRAFT" }, data: { updatedAt: c.clock.now() } });
      if (res.count !== 1) throw Errors.notFound("Journey not found.");
      await svc.writeJourneyLists(tx, id, lists);
    },
    respond: (userId, id) => svc.journeyDetail(userId, id),
    audit: (request, userId, id, fields) => audit(request, AuditActions.JOURNEY_UPDATED, userId, id, { fields }),
  });
}
