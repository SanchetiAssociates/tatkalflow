import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { createContainer, type AppContainer } from "../src/container.js";
import { createPrisma, type Db } from "../src/db.js";
import { FakeClock } from "../src/lib/clock.js";
import { MockOTPProvider } from "../src/modules/otp/otp-provider.js";
import { seed } from "../prisma/seed.js";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "prisma", "migrations");

export interface Harness {
  app: FastifyInstance;
  c: AppContainer;
  db: Db;
  clock: FakeClock;
  otp: MockOTPProvider;
  pglite: PGlite;
  close(): Promise<void>;
}

/**
 * A fresh in-memory PGlite database per test file, served over the Postgres
 * wire protocol so the app uses exactly the same driver path as production.
 * Migrations are the committed SQL files, applied in order.
 */
export async function createHarness(
  overrides: Partial<Record<keyof AppConfig, string>> = {},
  opts: { logStream?: { write(line: string): void } } = {},
): Promise<Harness> {
  const pglite = await PGlite.create();
  for (const dir of readdirSync(MIGRATIONS_DIR).filter((d) => /^\d+_/.test(d)).sort()) {
    await pglite.exec(readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
  }
  const server = new PGLiteSocketServer({ db: pglite, port: 0, maxConnections: 10 });
  await server.start();
  const databaseUrl = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;

  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: "4",
    JWT_ACCESS_SECRET: "test-jwt-secret-0123456789abcdefghijklmnop",
    OTP_HASH_PEPPER: "test-otp-pepper-0123456789abcdefghijklmnop",
    IP_HASH_PEPPER: "test-ip-pepper-0123456789abcdefghijklmnopq",
    CORS_ORIGINS: "http://localhost:5173",
    COOKIE_SECURE: "true",
    ...overrides,
  });
  const db = createPrisma(config.DATABASE_URL, config.DATABASE_POOL_MAX);
  await seed(db);
  const clock = new FakeClock();
  const otp = new MockOTPProvider();
  const c = createContainer({ config, db, clock, otpProvider: otp });
  const app = await buildApp(c, { logStream: opts.logStream });
  await app.ready();

  return {
    app,
    c,
    db,
    clock,
    otp,
    pglite,
    async close() {
      await app.close();
      await db.$disconnect();
      await server.stop();
      await pglite.close();
    },
  };
}

export const CSRF = { "x-tatkalflow-csrf": "1", origin: "http://localhost:5173" };

export function refreshCookieFrom(res: { cookies: Array<{ name: string; value: string }> }): string | undefined {
  return res.cookies.find((ck) => ck.name === "tf_rt")?.value;
}

/** Full sign-in via the public API; returns tokens for follow-up requests. */
export async function signIn(h: Harness, mobile = "9820012345", remoteAddress = "10.0.0.1") {
  const req = await h.app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { mobile }, remoteAddress });
  if (req.statusCode !== 200) throw new Error(`otp request failed: ${req.statusCode} ${req.body}`);
  const { otpSessionId } = req.json();
  const e164 = mobile.startsWith("+") ? mobile : `+91${mobile.slice(-10)}`;
  const code = h.otp.lastCodeFor(e164)!;
  const res = await h.app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { otpSessionId, code }, remoteAddress });
  if (res.statusCode !== 200) throw new Error(`verify failed: ${res.statusCode} ${res.body}`);
  return { ...res.json(), refreshToken: refreshCookieFrom(res)!, setCookie: res.headers["set-cookie"] };
}
