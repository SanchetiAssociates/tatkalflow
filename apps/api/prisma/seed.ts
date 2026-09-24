import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createPrisma, type Db } from "../src/db.js";
import { systemClock } from "../src/lib/clock.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { RailwayRulesService } from "../src/modules/rules/railway-rules.service.js";
import { SEED_RULES, SEED_SETTINGS } from "./seed-data.js";

/** Idempotent: rules are only created for keys that have no rule yet. */
export async function seed(db: Db): Promise<{ rulesCreated: number; settingsUpserted: number }> {
  const rules = new RailwayRulesService(db, systemClock, new AuditService(db));
  let rulesCreated = 0;
  for (const rule of SEED_RULES) {
    const exists = await db.railwayRule.findFirst({ where: { ruleKey: rule.ruleKey }, select: { id: true } });
    if (exists) continue;
    await rules.create(rule, { actorType: "SYSTEM" });
    rulesCreated++;
  }
  for (const s of SEED_SETTINGS) {
    await db.applicationSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value, description: s.description },
      update: {},
    });
  }
  return { rulesCreated, settingsUpserted: SEED_SETTINGS.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createPrisma(url, 2);
  const result = await seed(db);
  console.log(`Seed complete: ${result.rulesCreated} rules created, ${result.settingsUpserted} settings ensured.`);
  await db.$disconnect();
}
