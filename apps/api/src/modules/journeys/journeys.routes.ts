import type { FastifyInstance } from "fastify";
import { journeyDraftSchema, todayInIndia } from "@tatkalflow/shared";
import type { AppContainer } from "../../container.js";
import type { Prisma } from "../../db.js";
import { AppError, Errors } from "../../lib/errors.js";
import { parseIdParam } from "../../http/params.js";
import { authenticate, requestContext, requireAuth } from "../../http/request-context.js";
import { AuditActions } from "../audit/audit.service.js";

const journeyInclude = {
  passengers: { orderBy: { position: "asc" }, include: { passenger: { select: { id: true, name: true, age: true, gender: true, berthPreference: true } } } },
} satisfies Prisma.JourneyInclude;
type JourneyRow = Prisma.JourneyGetPayload<{ include: typeof journeyInclude }>;

function toDto(j: JourneyRow, names: Map<string, string>) {
  return {
    id: j.id,
    fromStationCode: j.fromStationCode,
    fromStationName: names.get(j.fromStationCode) ?? null,
    toStationCode: j.toStationCode,
    toStationName: names.get(j.toStationCode) ?? null,
    journeyDate: j.journeyDate.toISOString().slice(0, 10),
    quota: j.quota,
    state: j.state,
    passengers: j.passengers.map((jp) => jp.passenger),
    createdAt: j.createdAt.toISOString(),
  };
}

/**
 * Phase 3: minimal DRAFT journeys (route, date, passengers) so onboarding can
 * save a first journey. Trains, class priority, preferences and Tatkal
 * scheduling arrive in Phase 4+.
 */
export async function journeyRoutes(app: FastifyInstance, c: AppContainer) {
  const auth = { preHandler: authenticate(c.tokens) };

  async function stationNames(codes: string[]) {
    const rows = await c.db.station.findMany({ where: { code: { in: [...new Set(codes)] } }, select: { code: true, name: true } });
    return new Map(rows.map((r) => [r.code, r.name]));
  }

  async function warningsFor(passengerCount: number): Promise<string[]> {
    const warnings: string[] = [];
    const limit = await c.rules.find("tatkal.max_passengers_per_pnr");
    if (!limit) warnings.push("The Tatkal passenger limit per booking is not configured yet, so it could not be checked.");
    else if (passengerCount > limit.value) {
      throw new AppError(400, "TOO_MANY_PASSENGERS", `Tatkal bookings allow up to ${limit.value} passengers per booking.`, { max: limit.value });
    } else if (!limit.isVerified) warnings.push("The passenger limit used for this check has not been verified yet.");
    const gaps = await c.rules.verificationGaps();
    if (gaps.some((g) => g.ruleKey.startsWith("tatkal.") && g.ruleKey.includes("opening"))) {
      warnings.push("Tatkal opening-time rules have not been verified against an official source yet.");
    }
    return warnings;
  }

  app.get("/api/journeys", auth, async (request) => {
    const { userId } = requireAuth(request);
    const rows = await c.db.journey.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ journeyDate: "asc" }, { createdAt: "asc" }],
      include: journeyInclude,
    });
    const names = await stationNames(rows.flatMap((j) => [j.fromStationCode, j.toStationCode]));
    return rows.map((j) => toDto(j, names));
  });

  app.get("/api/journeys/:id", auth, async (request) => {
    const { userId } = requireAuth(request);
    const j = await c.db.journey.findFirst({ where: { id: parseIdParam(request.params), userId, deletedAt: null }, include: journeyInclude });
    if (!j) throw Errors.notFound("Journey not found.");
    return toDto(j, await stationNames([j.fromStationCode, j.toStationCode]));
  });

  app.post("/api/journeys", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const input = journeyDraftSchema.parse(request.body);
    if (input.journeyDate < todayInIndia(c.clock.now())) {
      throw new AppError(400, "VALIDATION_ERROR", "Some details need attention.", {
        fields: [{ path: "journeyDate", message: "Journey date is in the past" }],
      });
    }
    await c.stations.requireActive([input.fromStationCode, input.toStationCode]);
    // Ownership: every passenger must belong to this user. Others' IDs look like unknown IDs.
    const owned = await c.db.passenger.findMany({ where: { id: { in: input.passengerIds }, userId, deletedAt: null }, select: { id: true } });
    if (owned.length !== input.passengerIds.length) throw Errors.notFound("One or more passengers were not found.");
    const warnings = await warningsFor(input.passengerIds.length);

    const now = c.clock.now();
    const journey = await c.db.$transaction(async (tx) => {
      const j = await tx.journey.create({
        data: {
          userId,
          fromStationCode: input.fromStationCode,
          toStationCode: input.toStationCode,
          journeyDate: new Date(`${input.journeyDate}T00:00:00.000Z`),
          quota: "TATKAL",
          state: "DRAFT",
          passengers: { create: input.passengerIds.map((passengerId, position) => ({ passengerId, position })) },
        },
        include: journeyInclude,
      });
      await tx.passenger.updateMany({ where: { id: { in: input.passengerIds }, userId }, data: { lastUsedAt: now } });
      await c.stations.recordUse(userId, [input.fromStationCode, input.toStationCode], tx);
      return j;
    });
    const ctx = requestContext(request, c.config);
    await c.audit.record({
      action: AuditActions.JOURNEY_CREATED,
      userId,
      entityType: "journey",
      entityId: journey.id,
      metadata: { state: "DRAFT", passengerCount: input.passengerIds.length },
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });
    const names = await stationNames([journey.fromStationCode, journey.toStationCode]);
    return reply.code(201).send({ journey: toDto(journey, names), warnings });
  });

  app.delete("/api/journeys/:id", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const id = parseIdParam(request.params);
    const res = await c.db.journey.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: c.clock.now() } });
    if (res.count !== 1) throw Errors.notFound("Journey not found.");
    const ctx = requestContext(request, c.config);
    await c.audit.record({ action: AuditActions.JOURNEY_DELETED, userId, entityType: "journey", entityId: id, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
    return reply.code(204).send();
  });
}
