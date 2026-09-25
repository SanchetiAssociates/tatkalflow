import type { RateLimitPluginOptions } from "@fastify/rate-limit";
import type { AppConfig } from "../config.js";

/**
 * HTTP rate-limit configuration behind one seam.
 *
 * V1 is single-instance: counters live in process memory ("memory" store).
 * Running more than one API instance requires a shared store — add it here
 * (e.g. a PostgreSQL-backed store implementing @fastify/rate-limit's store
 * interface, keeping the no-Redis decision) and select it via RATE_LIMIT_STORE.
 * OTP abuse limits do NOT depend on this: they are enforced from the database.
 */
export function rateLimitOptions(config: Pick<AppConfig, "RATE_LIMIT_STORE">): RateLimitPluginOptions {
  const base: RateLimitPluginOptions = { global: true, max: 300, timeWindow: "1 minute" };
  switch (config.RATE_LIMIT_STORE) {
    case "memory":
      return base;
  }
}
