import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { AppContainer } from "./container.js";
import { rateLimitOptions } from "./http/rate-limit.js";
import { CSRF_HEADER } from "./http/request-context.js";
import { AppError } from "./lib/errors.js";
import { loggerOptions } from "./logging.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { journeyRoutes } from "./modules/journeys/journeys.routes.js";
import { passengerRoutes } from "./modules/passengers/passengers.routes.js";
import { stationRoutes } from "./modules/stations/stations.routes.js";
import { systemRoutes } from "./modules/system/system.routes.js";
import { meRoutes } from "./modules/users/me.routes.js";

export interface BuildAppOptions {
  /** Tests only: capture real log output to assert nothing sensitive is logged. */
  logStream?: { write(line: string): void };
}

export async function buildApp(c: AppContainer, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { config } = c;
  const app = Fastify({
    logger: opts.logStream ? { ...loggerOptions({ ...config, NODE_ENV: "development", LOG_LEVEL: "trace" }), stream: opts.logStream } : loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024,
  });

  // In production behind a TLS-terminating proxy, refuse plain HTTP.
  if (config.NODE_ENV === "production") {
    app.addHook("onRequest", async (request, reply) => {
      if (request.protocol !== "https") {
        return reply.code(426).send({ error: { code: "HTTPS_REQUIRED", message: "HTTPS is required." } });
      }
    });
  }

  await app.register(helmet, {
    // The API only serves JSON; nothing should ever render or frame it.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
  });
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "authorization", CSRF_HEADER],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(rateLimit, rateLimitOptions(config));

  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.setErrorHandler((error: FastifyError | AppError | ZodError | Error, request, reply) => {
    const requestId = request.id;
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Some details need attention.",
          fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          requestId,
        },
      });
    }
    if (error instanceof AppError) {
      if (error.statusCode === 429 && typeof error.details?.retryAfterSeconds === "number") {
        reply.header("retry-after", String(error.details.retryAfterSeconds));
      }
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.publicMessage, ...(error.details ?? {}), requestId },
      });
    }
    const status = (error as FastifyError).statusCode;
    if (status === 429) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down.", requestId } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: "BAD_REQUEST", message: "The request could not be processed.", requestId } });
    }
    // Unexpected: log for operators (bodies are never logged), return nothing internal.
    request.log.error({ err: { type: error.name, message: error.message, stack: error.stack } }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again.", requestId } });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found.", requestId: request.id } }),
  );

  await authRoutes(app, c);
  await meRoutes(app, c);
  await systemRoutes(app, c);
  await passengerRoutes(app, c);
  await stationRoutes(app, c);
  await journeyRoutes(app, c);

  return app;
}
