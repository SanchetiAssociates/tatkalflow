import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createPrisma, type Db } from "../src/db.js";
import { systemClock } from "../src/lib/clock.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { loadRulesRegistry } from "../src/modules/rules/registry.js";
import { RailwayRulesService, type SyncReport } from "../src/modules/rules/railway-rules.service.js";
import { SEED_SETTINGS } from "./seed-data.js";

/** Idempotent: syncs the rules registry and ensures default settings exist. */
export async function seed(db: Db): Promise<{ rules: SyncReport; settingsUpserted: number }> {
  const rules = new RailwayRulesService(db, systemClock, new AuditService(db), { enforceVerification: false, reverifyAfterDays: 90 });
  const report = await rules.syncFromRegistry(loadRulesRegistry());
  for (const s of SEED_SETTINGS) {
    await db.applicationSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value, description: s.description },
      update: {},
    });
  }
  return { rules: report, settingsUpserted: SEED_SETTINGS.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createPrisma(url, 2);
  const { rules, settingsUpserted } = await seed(db);
  console.log(
    `Seed complete. Rules: ${rules.created.length} created, ${rules.updated.length} updated, ${rules.unchanged} unchanged.` +
      (rules.unmanaged.length ? ` WARNING: ${rules.unmanaged.length} ACTIVE rule(s) in the DB are not in the registry: ${rules.unmanaged.join(", ")}` : "") +
      ` Settings ensured: ${settingsUpserted}.`,
  );
  await db.$disconnect();
}
