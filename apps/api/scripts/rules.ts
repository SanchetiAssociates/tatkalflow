/**
 * Railway rules operations.
 *
 *   npm run rules:sync     apply rules/railway-rules.json to the database
 *   npm run rules:status   show critical rules that are missing / unverified / stale
 */
import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { createPrisma } from "../src/db.js";
import { systemClock } from "../src/lib/clock.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { loadRulesRegistry } from "../src/modules/rules/registry.js";
import { RailwayRulesService } from "../src/modules/rules/railway-rules.service.js";

const command = process.argv[2];
const config = loadConfig();
const db = createPrisma(config.DATABASE_URL, 2);
const rules = new RailwayRulesService(db, systemClock, new AuditService(db), {
  enforceVerification: config.rulesEnforceVerification,
  reverifyAfterDays: config.RULE_REVERIFY_AFTER_DAYS,
});

try {
  if (command === "sync") {
    const r = await rules.syncFromRegistry(loadRulesRegistry());
    console.log(`created: ${r.created.join(", ") || "none"}\nupdated: ${r.updated.join(", ") || "none"}\nunchanged: ${r.unchanged}`);
    if (r.unmanaged.length) console.warn(`WARNING — ACTIVE rules not in registry: ${r.unmanaged.join(", ")}`);
  } else if (command === "status") {
    const gaps = await rules.verificationGaps();
    console.log(`Verification enforced: ${config.rulesEnforceVerification}`);
    if (!gaps.length) console.log("All critical rules are verified.");
    for (const g of gaps) console.log(`  ${g.state.padEnd(10)} ${g.ruleKey}`);
    process.exitCode = gaps.length ? 2 : 0;
  } else {
    console.error("Usage: tsx scripts/rules.ts <sync|status>");
    process.exitCode = 1;
  }
} finally {
  await db.$disconnect();
}
