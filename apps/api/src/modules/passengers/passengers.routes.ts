import type { FastifyInstance } from "fastify";
import { MAX_SAVED_PASSENGERS, passengerInputSchema, passengerUpdateSchema, type PassengerDto } from "@tatkalflow/shared";
import type { AppContainer } from "../../container.js";
import type { Passenger } from "../../generated/prisma/client.js";
import { AppError, Errors } from "../../lib/errors.js";
import { parseIdParam } from "../../http/params.js";
import { authenticate, requestContext, requireAuth } from "../../http/request-context.js";
import { AuditActions } from "../audit/audit.service.js";

export function toPassengerDto(p: Passenger): PassengerDto {
  return {
    id: p.id,
    name: p.name,
    age: p.age,
    gender: p.gender,
    berthPreference: p.berthPreference,
    foodPreference: p.foodPreference,
    seniorCitizenOptIn: p.seniorCitizenOptIn,
    childBerthOptIn: p.childBerthOptIn,
    lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * Every query is scoped by the authenticated user's ID. Someone else's
 * passenger is indistinguishable from a non-existent one (404).
 */
export async function passengerRoutes(app: FastifyInstance, c: AppContainer) {
  const auth = { preHandler: authenticate(c.tokens) };

  async function findOwned(userId: string, id: string) {
    const p = await c.db.passenger.findFirst({ where: { id, userId, deletedAt: null } });
    if (!p) throw Errors.notFound("Passenger not found.");
    return p;
  }

  function audit(request: Parameters<typeof requestContext>[0], action: (typeof AuditActions)[keyof typeof AuditActions], userId: string, id: string, fields?: string[]) {
    const ctx = requestContext(request, c.config);
    // IDs and field names only — no names/ages in the audit trail.
    return c.audit.record({ action, userId, entityType: "passenger", entityId: id, metadata: fields ? { fields } : {}, ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  }

  app.get("/api/passengers", auth, async (request) => {
    const { userId } = requireAuth(request);
    const rows = await c.db.passenger.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
    });
    return rows.map(toPassengerDto);
  });

  app.get("/api/passengers/:id", auth, async (request) => {
    const { userId } = requireAuth(request);
    return toPassengerDto(await findOwned(userId, parseIdParam(request.params)));
  });

  app.post("/api/passengers", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const input = passengerInputSchema.parse(request.body);
    const count = await c.db.passenger.count({ where: { userId, deletedAt: null } });
    if (count >= MAX_SAVED_PASSENGERS) {
      throw new AppError(409, "PASSENGER_LIMIT", `You can save up to ${MAX_SAVED_PASSENGERS} passengers. Remove one to add another.`);
    }
    const p = await c.db.passenger.create({ data: { ...input, userId } });
    await audit(request, AuditActions.PASSENGER_CREATED, userId, p.id);
    return reply.code(201).send(toPassengerDto(p));
  });

  app.patch("/api/passengers/:id", auth, async (request) => {
    const { userId } = requireAuth(request);
    const id = parseIdParam(request.params);
    const input = passengerUpdateSchema.parse(request.body);
    await findOwned(userId, id);
    // updateMany with the owner in the WHERE clause: ownership is enforced by the write itself.
    const res = await c.db.passenger.updateMany({ where: { id, userId, deletedAt: null }, data: input });
    if (res.count !== 1) throw Errors.notFound("Passenger not found.");
    await audit(request, AuditActions.PASSENGER_UPDATED, userId, id, Object.keys(input));
    return toPassengerDto(await findOwned(userId, id));
  });

  app.delete("/api/passengers/:id", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const id = parseIdParam(request.params);
    const res = await c.db.passenger.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: c.clock.now() } });
    if (res.count !== 1) throw Errors.notFound("Passenger not found.");
    await audit(request, AuditActions.PASSENGER_DELETED, userId, id);
    return reply.code(204).send();
  });
}
