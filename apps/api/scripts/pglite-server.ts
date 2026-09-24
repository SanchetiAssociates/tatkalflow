/**
 * Local development database: PGlite (Postgres compiled to WASM) exposed over
 * the Postgres wire protocol. Prisma, pg and pg-boss connect to it exactly as
 * they would to a real PostgreSQL server — only DATABASE_URL changes in prod.
 *
 *   npm run db:dev            # persistent data in apps/api/.pglite/dev
 *   PGLITE_DATA_DIR=memory:// npm run db:dev   # throwaway in-memory DB
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { mkdirSync } from "node:fs";

const dataDir = process.env.PGLITE_DATA_DIR ?? ".pglite/dev";
const port = Number(process.env.PGLITE_PORT ?? 55432);
const maxConnections = Number(process.env.PGLITE_MAX_CONNECTIONS ?? 10);

if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });

const db = await PGlite.create(dataDir);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections });
await server.start();
console.log(`PGlite listening on postgresql://postgres:postgres@127.0.0.1:${port}/postgres (data: ${dataDir})`);

async function shutdown() {
  await server.stop();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
