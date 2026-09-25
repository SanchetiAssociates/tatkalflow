/**
 * Import a complete station master dataset.
 *
 *   npm run stations:import -- --file ./stations.csv --version 2026.10 \
 *     --source "Publisher / dataset name" --source-url https://… --license "…"
 *
 * Options: --format csv|json (default from extension), --allow-small (subset
 * datasets), --force (allow deactivating >20% of stations), --dry-run.
 * Nothing is imported unless every record validates.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { createPrisma } from "../src/db.js";
import { systemClock } from "../src/lib/clock.js";
import { AppError } from "../src/lib/errors.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { parseStationFile } from "../src/modules/stations/station-parsers.js";
import { StationService } from "../src/modules/stations/station.service.js";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    format: { type: "string" },
    version: { type: "string" },
    source: { type: "string" },
    "source-url": { type: "string" },
    license: { type: "string" },
    notes: { type: "string" },
    "allow-small": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!values.file || !values.version || !values.source) {
  console.error("Required: --file, --version, --source");
  process.exit(1);
}
const format = (values.format ?? (extname(values.file).toLowerCase() === ".csv" ? "csv" : "json")) as "csv" | "json";
const records = parseStationFile(readFileSync(values.file, "utf8"), format);
console.log(`Parsed ${records.length} records from ${values.file} (${format}).`);
if (values["dry-run"]) process.exit(0);

const config = loadConfig();
const db = createPrisma(config.DATABASE_URL, 2);
try {
  const report = await new StationService(db, systemClock, new AuditService(db)).importDataset(
    records,
    { version: values.version, source: values.source, sourceUrl: values["source-url"] ?? null, license: values.license ?? null, notes: values.notes ?? null },
    { allowSmall: values["allow-small"], force: values.force },
  );
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  if (err instanceof AppError) {
    console.error(`${err.code}: ${err.publicMessage}`);
    if (err.details) console.error(JSON.stringify(err.details, null, 2));
    process.exitCode = 1;
  } else throw err;
} finally {
  await db.$disconnect();
}
