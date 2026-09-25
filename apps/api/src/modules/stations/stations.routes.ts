import type { FastifyInstance } from "fastify";
import { stationCodeSchema, stationSearchQuerySchema } from "@tatkalflow/shared";
import { z } from "zod";
import type { AppContainer } from "../../container.js";
import { Errors } from "../../lib/errors.js";
import { authenticate, requireAuth } from "../../http/request-context.js";

const codeParam = z.object({ code: stationCodeSchema });

export async function stationRoutes(app: FastifyInstance, c: AppContainer) {
  const auth = { preHandler: authenticate(c.tokens) };
  // Search is keystroke-driven: allow more than the default budget per IP.
  const searchLimit = { ...auth, config: { rateLimit: { max: 600, timeWindow: "1 minute" } } };

  app.get("/api/stations/search", searchLimit, async (request) => {
    const { q, limit } = stationSearchQuerySchema.parse(request.query);
    return c.stations.search(q, limit);
  });

  app.get("/api/stations/dataset", auth, async () => {
    const ds = await c.stations.activeDataset();
    if (!ds) return { installed: false as const };
    return {
      installed: true as const,
      version: ds.version,
      source: ds.source,
      sourceUrl: ds.sourceUrl,
      license: ds.license,
      recordCount: ds.recordCount,
      importedAt: ds.importedAt.toISOString(),
    };
  });

  app.get("/api/stations/mine", auth, async (request) => {
    const { userId } = requireAuth(request);
    return c.stations.mine(userId);
  });

  app.put("/api/stations/favourites/:code", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const parsed = codeParam.safeParse(request.params);
    if (!parsed.success) throw Errors.notFound("Station not found.");
    await c.stations.setFavourite(userId, parsed.data.code, true);
    return reply.code(204).send();
  });

  app.delete("/api/stations/favourites/:code", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const parsed = codeParam.safeParse(request.params);
    if (!parsed.success) throw Errors.notFound("Station not found.");
    await c.stations.setFavourite(userId, parsed.data.code, false);
    return reply.code(204).send();
  });
}
