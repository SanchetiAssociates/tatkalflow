import type { FastifyInstance } from "fastify";
import type { AppContainer } from "../../container.js";
import { authenticate } from "../../http/request-context.js";

export async function systemRoutes(app: FastifyInstance, c: AppContainer) {
  app.get("/api/health", { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await c.db.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded" });
    }
  });

  /**
   * Server time for client clock-skew detection (brief §40). The client
   * measures round-trip time and compares against its own clock.
   */
  app.get("/api/time", { config: { rateLimit: false } }, async () => {
    const now = c.clock.now();
    return { serverTime: now.toISOString(), epochMs: now.getTime(), timezone: "Asia/Kolkata" };
  });

  /** Railway rules currently in force, with provenance, for display in the app. */
  app.get("/api/rules/active", { preHandler: authenticate(c.tokens) }, async () => {
    const snapshot = await c.rules.snapshot();
    return Object.values(snapshot).map((r) => ({
      ruleKey: r.ruleKey,
      value: r.value,
      source: r.source,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      lastVerifiedAt: r.lastVerifiedAt?.toISOString() ?? null,
    }));
  });
}
