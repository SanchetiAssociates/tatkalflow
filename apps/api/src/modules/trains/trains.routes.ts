import type { FastifyInstance } from "fastify";
import { trainNumberSchema, trainSearchQuerySchema, type TrainSearchResult } from "@tatkalflow/shared";
import { z } from "zod";
import type { AppContainer } from "../../container.js";
import { Errors } from "../../lib/errors.js";
import { authenticate } from "../../http/request-context.js";

export async function trainRoutes(app: FastifyInstance, c: AppContainer) {
  const auth = { preHandler: authenticate(c.tokens) };
  // Search is keystroke-driven: allow more than the default budget per IP.
  const searchLimit = { ...auth, config: { rateLimit: { max: 600, timeWindow: "1 minute" } } };
  const provider = c.journeys.trains;

  app.get("/api/trains/search", searchLimit, async (request): Promise<TrainSearchResult> => {
    const { q, from, to, limit } = trainSearchQuerySchema.parse(request.query);
    return {
      provider: provider.name,
      available: provider.available,
      results: await provider.search(q, { ...(from && { from }), ...(to && { to }), limit }),
    };
  });

  app.get("/api/trains/:number", auth, async (request) => {
    const parsed = z.object({ number: trainNumberSchema }).safeParse(request.params);
    if (!parsed.success) throw Errors.notFound("Train not found.");
    const train = await provider.findByNumber(parsed.data.number);
    if (!train) throw Errors.notFound("Train not found.");
    return train;
  });
}
