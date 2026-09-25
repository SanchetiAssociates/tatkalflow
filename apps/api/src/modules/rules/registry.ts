import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RailwayRuleInput } from "@tatkalflow/shared";

/** Path to the source-controlled rules registry (apps/api/rules/railway-rules.json). */
export const RULES_REGISTRY_PATH = join(import.meta.dirname, "..", "..", "..", "rules", "railway-rules.json");

export function loadRulesRegistry(path = RULES_REGISTRY_PATH): RailwayRuleInput[] {
  const doc = JSON.parse(readFileSync(path, "utf8")) as { rules?: unknown };
  if (!Array.isArray(doc.rules)) throw new Error(`${path}: expected a "rules" array`);
  return doc.rules as RailwayRuleInput[];
}
