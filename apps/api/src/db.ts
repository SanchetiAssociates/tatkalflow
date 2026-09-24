import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

/**
 * The same driver adapter (node-postgres) is used against PGlite in
 * development/tests and PostgreSQL in production. Only DATABASE_URL differs.
 */
export function createPrisma(databaseUrl: string, poolMax: number): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: poolMax });
  return new PrismaClient({ adapter });
}

export type Db = PrismaClient;
export type { Prisma } from "./generated/prisma/client.js";
