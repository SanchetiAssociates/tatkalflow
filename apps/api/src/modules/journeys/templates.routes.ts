import type { FastifyInstance, FastifyRequest } from "fastify";
import { journeyFromTemplateSchema, journeyTemplateInputSchema, journeyTemplateUpdateSchema, MAX_JOURNEY_TEMPLATES } from "@tatkalflow/shared";
import type { AppContainer } from "../../container.js";
import type { Prisma } from "../../db.js";
import { AppError, Errors } from "../../lib/errors.js";
import { parseIdParam } from "../../http/params.js";
import { authenticate, requestContext, requireAuth } from "../../http/request-context.js";
import { AuditActions, type AuditAction } from "../audit/audit.service.js";
import { registerConfigListRoutes } from "./config-lists.routes.js";
import { dateOf, templateConfig, templateInclude } from "./journey.service.js";

/**
 * Journey templates: reusable configurations without a date. A journey made
 * from a template copies its configuration (a snapshot), so later template
 * edits never change existing journeys.
 */
export async function journeyTemplateRoutes(app: FastifyInstance, c: AppContainer) {
  const auth = { preHandler: authenticate(c.tokens) };
  const svc = c.journeys;

  function audit(request: FastifyRequest, action: AuditAction, userId: string, entityType: string, id: string, metadata: Record<string, unknown> = {}) {
    const ctx = requestContext(request, c.config);
    return c.audit.record({ action, userId, entityType, entityId: id, metadata, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  }

  app.get("/api/journey-templates", auth, async (request) => {
    const { userId } = requireAuth(request);
    const rows = await c.db.journeyTemplate.findMany({ where: { userId, deletedAt: null }, orderBy: [{ updatedAt: "desc" }], include: templateInclude });
    const stations = await svc.stationInfo(rows.flatMap((t) => [t.fromStationCode, t.toStationCode, t.boardingStationCode]));
    return rows.map((t) => svc.configDto(templateConfig(t), stations));
  });

  app.get("/api/journey-templates/:id", auth, async (request) => {
    const { userId } = requireAuth(request);
    return svc.templateDto(userId, parseIdParam(request.params));
  });

  app.post("/api/journey-templates", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const input = journeyTemplateInputSchema.parse(request.body);
    const count = await c.db.journeyTemplate.count({ where: { userId, deletedAt: null } });
    if (count >= MAX_JOURNEY_TEMPLATES) {
      throw new AppError(409, "TEMPLATE_LIMIT", `You can save up to ${MAX_JOURNEY_TEMPLATES} templates. Remove one to add another.`);
    }
    await svc.requireStations([input.fromStationCode, input.toStationCode, input.boardingStationCode]);
    const passengers = await svc.resolvePassengers(userId, input.passengers);
    await svc.assertPassengerLimit(input.quota, passengers.length);
    const trains = await svc.resolveTrains(input.trains);

    const t = await c.db.$transaction(async (tx) => {
      const row = await tx.journeyTemplate.create({
        data: {
          userId,
          name: input.name,
          fromStationCode: input.fromStationCode,
          toStationCode: input.toStationCode,
          boardingStationCode: input.boardingStationCode,
          quota: input.quota,
          anyTrainAllowed: input.anyTrainAllowed,
          useNextAvailableClass: input.useNextAvailableClass,
          considerAutoUpgradation: input.considerAutoUpgradation,
          racWaitlistPreference: input.racWaitlistPreference,
        },
      });
      await svc.writeTemplateLists(tx, row.id, { passengers, trains, classes: input.classes });
      return row;
    });
    await audit(request, AuditActions.TEMPLATE_CREATED, userId, "journey_template", t.id, { passengerCount: passengers.length, trainCount: trains.length });
    return reply.code(201).send(await svc.templateDto(userId, t.id));
  });

  app.patch("/api/journey-templates/:id", auth, async (request) => {
    const { userId } = requireAuth(request);
    const id = parseIdParam(request.params);
    const input = journeyTemplateUpdateSchema.parse(request.body);
    const t = await svc.findTemplate(userId, id);
    const route = svc.normaliseRoute({
      fromStationCode: input.fromStationCode ?? t.fromStationCode,
      toStationCode: input.toStationCode ?? t.toStationCode,
      boardingStationCode: input.boardingStationCode !== undefined ? input.boardingStationCode : t.boardingStationCode,
    });
    await svc.requireStations([input.fromStationCode, input.toStationCode, input.boardingStationCode]);
    const passengers = input.passengers ? await svc.resolvePassengers(userId, input.passengers) : undefined;
    const quota = input.quota ?? t.quota;
    if (input.passengers || input.quota) await svc.assertPassengerLimit(quota, passengers?.length ?? t.passengers.length);
    const trains = input.trains ? await svc.resolveTrains(input.trains) : undefined;

    await c.db.$transaction(async (tx) => {
      const res = await tx.journeyTemplate.updateMany({
        where: { id, userId, deletedAt: null },
        data: {
          ...route,
          quota,
          ...(input.name !== undefined && { name: input.name }),
          ...(input.anyTrainAllowed !== undefined && { anyTrainAllowed: input.anyTrainAllowed }),
          ...(input.useNextAvailableClass !== undefined && { useNextAvailableClass: input.useNextAvailableClass }),
          ...(input.considerAutoUpgradation !== undefined && { considerAutoUpgradation: input.considerAutoUpgradation }),
          ...(input.racWaitlistPreference !== undefined && { racWaitlistPreference: input.racWaitlistPreference }),
        },
      });
      if (res.count !== 1) throw Errors.notFound("Template not found.");
      await svc.writeTemplateLists(tx, id, { ...(passengers && { passengers }), ...(trains && { trains }), ...(input.classes && { classes: input.classes }) });
    });
    await audit(request, AuditActions.TEMPLATE_UPDATED, userId, "journey_template", id, { fields: Object.keys(input) });
    return svc.templateDto(userId, id);
  });

  app.delete("/api/journey-templates/:id", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const id = parseIdParam(request.params);
    // Soft delete: journeys created from it are separate copies and are unaffected.
    const res = await c.db.journeyTemplate.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: c.clock.now() } });
    if (res.count !== 1) throw Errors.notFound("Template not found.");
    await audit(request, AuditActions.TEMPLATE_DELETED, userId, "journey_template", id);
    return reply.code(204).send();
  });

  /** Create a dated journey from a template by copying its configuration. */
  app.post("/api/journey-templates/:id/journeys", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const templateId = parseIdParam(request.params);
    const input = journeyFromTemplateSchema.parse(request.body);
    const t = await svc.findTemplate(userId, templateId);
    svc.assertNotPast(input.journeyDate);
    // Passengers since removed from the saved list are not carried over.
    const kept = t.passengers.filter((p) => p.passenger.deletedAt === null);
    await svc.assertPassengerLimit(t.quota, kept.length);
    const snapshot = await svc.ruleSnapshotNow();
    const now = c.clock.now();

    const journey = await c.db.$transaction(async (tx) => {
      const j = await tx.journey.create({
        data: {
          userId,
          templateId: t.id,
          name: input.name ?? t.name,
          fromStationCode: t.fromStationCode,
          toStationCode: t.toStationCode,
          boardingStationCode: t.boardingStationCode,
          journeyDate: dateOf(input.journeyDate),
          quota: t.quota,
          state: "DRAFT",
          anyTrainAllowed: t.anyTrainAllowed,
          useNextAvailableClass: t.useNextAvailableClass,
          considerAutoUpgradation: t.considerAutoUpgradation,
          racWaitlistPreference: t.racWaitlistPreference,
          ruleSnapshot: snapshot as Prisma.InputJsonValue,
        },
      });
      await svc.writeJourneyLists(tx, j.id, {
        passengers: kept.map((p) => ({ passengerId: p.passengerId, berthPreference: p.berthPreference })),
        trains: t.trains.map((x) => ({ trainNumber: x.trainNumber, trainName: x.trainName })),
        classes: t.classes.map((k) => k.classCode),
      });
      if (kept.length) await tx.passenger.updateMany({ where: { id: { in: kept.map((p) => p.passengerId) }, userId }, data: { lastUsedAt: now } });
      await c.stations.recordUse(userId, [t.fromStationCode, t.toStationCode], tx);
      return j;
    });
    await audit(request, AuditActions.JOURNEY_CREATED, userId, "journey", journey.id, { state: "DRAFT", fromTemplate: true, templateId: t.id, passengerCount: kept.length });
    const detail = await svc.journeyDetail(userId, journey.id);
    const skipped = t.passengers.length - kept.length;
    const warnings = [
      ...(skipped ? [`${skipped} passenger${skipped === 1 ? " was" : "s were"} left out because they were removed from your saved passengers.`] : []),
      ...detail.readiness.items.filter((i) => i.status === "WARN" && i.detail).map((i) => i.detail!),
    ];
    return reply.code(201).send({ journey: detail, warnings });
  });

  registerConfigListRoutes(app, c, {
    basePath: "/api/journey-templates",
    async load(userId, id) {
      const t = await svc.findTemplate(userId, id);
      return {
        quota: t.quota,
        passengers: t.passengers.map((p) => ({ passengerId: p.passengerId, berthPreference: p.berthPreference })),
        trains: t.trains.map((x) => ({ trainNumber: x.trainNumber, trainName: x.trainName })),
        classes: t.classes.map((k) => k.classCode),
      };
    },
    async write(tx, userId, id, lists) {
      const res = await tx.journeyTemplate.updateMany({ where: { id, userId, deletedAt: null }, data: { updatedAt: c.clock.now() } });
      if (res.count !== 1) throw Errors.notFound("Template not found.");
      await svc.writeTemplateLists(tx, id, lists);
    },
    respond: (userId, id) => svc.templateDto(userId, id),
    audit: (request, userId, id, fields) => audit(request, AuditActions.TEMPLATE_UPDATED, userId, "journey_template", id, { fields }),
  });
}
