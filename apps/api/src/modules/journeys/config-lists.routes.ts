import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  addClassSchema,
  addPassengerSchema,
  addTrainSchema,
  classCodeSchema,
  MAX_PREFERRED_TRAINS,
  setClassesSchema,
  setPassengersSchema,
  setTrainsSchema,
  trainNumberSchema,
  type Quota,
} from "@tatkalflow/shared";
import { z } from "zod";
import type { AppContainer } from "../../container.js";
import type { Prisma } from "../../db.js";
import { AppError, Errors } from "../../lib/errors.js";
import { authenticate, requireAuth } from "../../http/request-context.js";
import type { PassengerRow, TrainRow } from "./journey.service.js";

type Lists = { passengers?: PassengerRow[]; trains?: TrainRow[]; classes?: string[] };

/** How a journey or a template exposes its ordered lists to the shared routes. */
export interface ListOwner {
  basePath: "/api/journeys" | "/api/journey-templates";
  /** Current lists of a record the user owns and may edit (404 / 409 otherwise). */
  load(userId: string, id: string): Promise<{ quota: Quota; passengers: PassengerRow[]; trains: TrainRow[]; classes: string[] }>;
  /** Writes inside the transaction; must re-check ownership in the WHERE clause. */
  write(tx: Prisma.TransactionClient, userId: string, id: string, lists: Lists): Promise<void>;
  respond(userId: string, id: string): Promise<unknown>;
  audit(request: FastifyRequest, userId: string, id: string, fields: string[]): Promise<void>;
}

const idWith = <K extends string>(key: K, schema: z.ZodType<string>) => z.object({ id: z.uuid() }).extend({ [key]: schema } as Record<K, z.ZodType<string>>);

/** Malformed IDs are answered exactly like unknown ones (404). */
function parseParams<T>(schema: z.ZodType<T>, params: unknown): T {
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw Errors.notFound();
  return parsed.data;
}

/**
 * Add / remove / reorder passengers, preferred trains and class preferences.
 * PUT replaces the whole ordered list (that is how reordering works); POST
 * appends; DELETE removes one item and closes the gap, so priorities stay 1..n.
 */
export function registerConfigListRoutes(app: FastifyInstance, c: AppContainer, owner: ListOwner) {
  const auth = { preHandler: authenticate(c.tokens) };
  const base = owner.basePath;

  async function save(request: FastifyRequest, userId: string, id: string, lists: Lists) {
    await c.db.$transaction((tx) => owner.write(tx, userId, id, lists));
    await owner.audit(request, userId, id, Object.keys(lists));
    return owner.respond(userId, id);
  }

  // ── Passengers ─────────────────────────────────────────────────────────

  app.put(`${base}/:id/passengers`, auth, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = parseParams(z.object({ id: z.uuid() }), request.params);
    const { passengers } = setPassengersSchema.parse(request.body);
    const current = await owner.load(userId, id);
    const rows = await c.journeys.resolvePassengers(userId, passengers);
    await c.journeys.assertPassengerLimit(current.quota, rows.length);
    return save(request, userId, id, { passengers: rows });
  });

  app.post(`${base}/:id/passengers`, auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = parseParams(z.object({ id: z.uuid() }), request.params);
    const selection = addPassengerSchema.parse(request.body);
    const current = await owner.load(userId, id);
    if (current.passengers.some((p) => p.passengerId === selection.passengerId)) {
      throw new AppError(409, "ALREADY_ADDED", "This passenger is already on the list.");
    }
    const [row] = await c.journeys.resolvePassengers(userId, [selection]);
    const next = [...current.passengers, row!];
    await c.journeys.assertPassengerLimit(current.quota, next.length);
    return reply.code(201).send(await save(request, userId, id, { passengers: next }));
  });

  app.delete(`${base}/:id/passengers/:passengerId`, auth, async (request) => {
    const { userId } = requireAuth(request);
    const { id, passengerId } = parseParams(idWith("passengerId", z.uuid()), request.params);
    const current = await owner.load(userId, id);
    if (!current.passengers.some((p) => p.passengerId === passengerId)) throw Errors.notFound("Passenger not on this list.");
    return save(request, userId, id, { passengers: current.passengers.filter((p) => p.passengerId !== passengerId) });
  });

  // ── Preferred trains ───────────────────────────────────────────────────

  app.put(`${base}/:id/trains`, auth, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = parseParams(z.object({ id: z.uuid() }), request.params);
    const { trains } = setTrainsSchema.parse(request.body);
    await owner.load(userId, id);
    return save(request, userId, id, { trains: await c.journeys.resolveTrains(trains) });
  });

  app.post(`${base}/:id/trains`, auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = parseParams(z.object({ id: z.uuid() }), request.params);
    const { trainNumber } = addTrainSchema.parse(request.body);
    const current = await owner.load(userId, id);
    if (current.trains.some((t) => t.trainNumber === trainNumber)) throw new AppError(409, "ALREADY_ADDED", "This train is already on the list.");
    if (current.trains.length >= MAX_PREFERRED_TRAINS) {
      throw new AppError(400, "TOO_MANY_TRAINS", `Choose up to ${MAX_PREFERRED_TRAINS} trains.`, { max: MAX_PREFERRED_TRAINS });
    }
    const [row] = await c.journeys.resolveTrains([trainNumber]);
    return reply.code(201).send(await save(request, userId, id, { trains: [...current.trains, row!] }));
  });

  app.delete(`${base}/:id/trains/:trainNumber`, auth, async (request) => {
    const { userId } = requireAuth(request);
    const { id, trainNumber } = parseParams(idWith("trainNumber", trainNumberSchema), request.params);
    const current = await owner.load(userId, id);
    if (!current.trains.some((t) => t.trainNumber === trainNumber)) throw Errors.notFound("Train not on this list.");
    return save(request, userId, id, { trains: current.trains.filter((t) => t.trainNumber !== trainNumber) });
  });

  // ── Class preferences ──────────────────────────────────────────────────

  app.put(`${base}/:id/classes`, auth, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = parseParams(z.object({ id: z.uuid() }), request.params);
    const { classes } = setClassesSchema.parse(request.body);
    await owner.load(userId, id);
    return save(request, userId, id, { classes });
  });

  app.post(`${base}/:id/classes`, auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = parseParams(z.object({ id: z.uuid() }), request.params);
    const { classCode } = addClassSchema.parse(request.body);
    const current = await owner.load(userId, id);
    if (current.classes.includes(classCode)) throw new AppError(409, "ALREADY_ADDED", "This class is already on the list.");
    return reply.code(201).send(await save(request, userId, id, { classes: [...current.classes, classCode] }));
  });

  app.delete(`${base}/:id/classes/:classCode`, auth, async (request) => {
    const { userId } = requireAuth(request);
    const { id, classCode } = parseParams(idWith("classCode", classCodeSchema), request.params);
    const current = await owner.load(userId, id);
    if (!current.classes.includes(classCode)) throw Errors.notFound("Class not on this list.");
    if (current.classes.length === 1) throw new AppError(400, "LAST_CLASS", "Keep at least one class preference.");
    return save(request, userId, id, { classes: current.classes.filter((k) => k !== classCode) });
  });
}
