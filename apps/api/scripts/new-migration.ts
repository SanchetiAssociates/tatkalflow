/**
 * Generate a new SQL migration from schema.prisma changes, without needing a
 * local PostgreSQL server: a throwaway in-memory PGlite acts as the shadow DB.
 *
 *   npm run db:new-migration -- add_something
 *
 * Review the generated SQL before committing it. Apply with `npm run db:migrate`.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";

const name = (process.argv[2] ?? "").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
if (!name) {
  console.error("Usage: npm run db:new-migration -- <name>");
  process.exit(1);
}

const shadow = await PGlite.create();
const server = new PGLiteSocketServer({ db: shadow, port: 0, maxConnections: 4 });
await server.start();
const shadowUrl = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;

try {
  // Must be async: the shadow PGlite is served from this same process.
  const { stdout: sql } = await promisify(execFile)(
    "npx",
    ["prisma", "migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema", "prisma/schema.prisma", "--script"],
    {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? shadowUrl, SHADOW_DATABASE_URL: shadowUrl },
    },
  );
  if (!sql.trim() || /This is an empty migration/.test(sql)) {
    console.log("No schema changes detected.");
  } else {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const dir = `prisma/migrations/${stamp}_${name}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/migration.sql`, sql);
    console.log(`Created ${dir}/migration.sql — review it before committing.`);
  }
} finally {
  await server.stop();
  await shadow.close();
}
