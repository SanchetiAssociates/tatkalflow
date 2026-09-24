import {
  isRuleKey,
  railwayRuleSchema,
  ruleValueSchemas,
  type RailwayRuleInput,
  type RuleKey,
  type RuleValue,
} from "@tatkalflow/shared";
import type { Db, Prisma } from "../../db.js";
import { AppError, Errors } from "../../lib/errors.js";
import type { Clock } from "../../lib/clock.js";
import { AuditActions, type AuditService } from "../audit/audit.service.js";

export interface ResolvedRule<K extends RuleKey = RuleKey> {
  id: string;
  ruleKey: K;
  value: RuleValue<K>;
  source: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  lastVerifiedAt: Date | null;
}

const CACHE_TTL_MS = 60_000;

/**
 * Single source of truth for railway regulations (Tatkal timings, passenger
 * limits, age thresholds…). Rules are versioned rows with an effective period;
 * changing a rule is a data change, never a code change.
 *
 * Resolution: the ACTIVE row for the key whose [effectiveFrom, effectiveTo)
 * contains the requested instant. ACTIVE periods for a key may not overlap,
 * so resolution is unambiguous.
 */
export class RailwayRulesService {
  private cache: { at: number; rows: ResolvedRule[] } | null = null;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  private async activeRows(): Promise<ResolvedRule[]> {
    const nowMs = this.clock.now().getTime();
    if (this.cache && nowMs - this.cache.at < CACHE_TTL_MS) return this.cache.rows;
    const rows = await this.db.railwayRule.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ ruleKey: "asc" }, { effectiveFrom: "desc" }],
    });
    const resolved: ResolvedRule[] = [];
    for (const row of rows) {
      if (!isRuleKey(row.ruleKey)) continue; // unknown keys are ignored, not trusted
      const parsed = ruleValueSchemas[row.ruleKey].safeParse(row.value);
      if (!parsed.success) continue; // an invalid row must never be used for timing
      resolved.push({
        id: row.id,
        ruleKey: row.ruleKey,
        value: parsed.data,
        source: row.source,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        lastVerifiedAt: row.lastVerifiedAt,
      } as ResolvedRule);
    }
    this.cache = { at: nowMs, rows: resolved };
    return resolved;
  }

  /** The rule in force at `at` (defaults to now). Throws if none is configured. */
  async get<K extends RuleKey>(key: K, at: Date = this.clock.now()): Promise<ResolvedRule<K>> {
    const rule = await this.find(key, at);
    if (!rule) throw Errors.ruleNotConfigured(key);
    return rule;
  }

  async find<K extends RuleKey>(key: K, at: Date = this.clock.now()): Promise<ResolvedRule<K> | null> {
    const t = at.getTime();
    const rows = await this.activeRows();
    const match = rows.find(
      (r) => r.ruleKey === key && r.effectiveFrom.getTime() <= t && (r.effectiveTo === null || r.effectiveTo.getTime() > t),
    );
    return (match as ResolvedRule<K> | undefined) ?? null;
  }

  async getValue<K extends RuleKey>(key: K, at?: Date): Promise<RuleValue<K>> {
    return (await this.get(key, at)).value;
  }

  /** All rules in force at `at`, keyed by rule key. */
  async snapshot(at: Date = this.clock.now()): Promise<Partial<Record<RuleKey, ResolvedRule>>> {
    const out: Partial<Record<RuleKey, ResolvedRule>> = {};
    const t = at.getTime();
    for (const r of await this.activeRows()) {
      if (out[r.ruleKey]) continue;
      if (r.effectiveFrom.getTime() <= t && (r.effectiveTo === null || r.effectiveTo.getTime() > t)) out[r.ruleKey] = r;
    }
    return out;
  }

  /**
   * Create a rule version. ACTIVE versions are checked for overlap with other
   * ACTIVE versions of the same key; to replace a rule, close the old one's
   * effectiveTo first (see `supersede`).
   */
  async create(input: RailwayRuleInput, actor: { userId?: string; actorType: "SYSTEM" | "ADMIN" }) {
    const rule = railwayRuleSchema.parse(input);
    const effectiveFrom = new Date(rule.effectiveFrom);
    const effectiveTo = rule.effectiveTo ? new Date(rule.effectiveTo) : null;

    const created = await this.db.$transaction(async (tx) => {
      if (rule.status === "ACTIVE") await assertNoOverlap(tx, rule.ruleKey, effectiveFrom, effectiveTo);
      const row = await tx.railwayRule.create({
        data: {
          ruleKey: rule.ruleKey,
          value: rule.value as Prisma.InputJsonValue,
          source: rule.source,
          effectiveFrom,
          effectiveTo,
          lastVerifiedAt: rule.lastVerifiedAt ? new Date(rule.lastVerifiedAt) : null,
          status: rule.status,
          notes: rule.notes ?? null,
        },
      });
      await this.audit.record(
        {
          action: AuditActions.RULE_CHANGED,
          actorType: actor.actorType,
          userId: actor.userId ?? null,
          entityType: "railway_rule",
          entityId: row.id,
          metadata: { ruleKey: row.ruleKey, value: rule.value, status: row.status, effectiveFrom, effectiveTo },
        },
        tx,
      );
      return row;
    });
    this.invalidate();
    return created;
  }

  /**
   * Replace the currently-active version of a rule from `effectiveFrom`
   * onwards: closes the old period and opens the new one atomically.
   */
  async supersede(
    input: Omit<RailwayRuleInput, "status" | "effectiveTo"> & { effectiveTo?: string | null },
    actor: { userId?: string; actorType: "SYSTEM" | "ADMIN" },
  ) {
    const from = new Date(input.effectiveFrom);
    await this.db.railwayRule.updateMany({
      where: {
        ruleKey: input.ruleKey,
        status: "ACTIVE",
        effectiveFrom: { lt: from },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }],
      },
      data: { effectiveTo: from },
    });
    this.invalidate();
    return this.create({ ...input, effectiveTo: input.effectiveTo ?? null, status: "ACTIVE" }, actor);
  }

  async markVerified(id: string, at: Date = this.clock.now()) {
    await this.db.railwayRule.update({ where: { id }, data: { lastVerifiedAt: at } });
    this.invalidate();
  }
}

async function assertNoOverlap(tx: Prisma.TransactionClient, ruleKey: string, from: Date, to: Date | null) {
  const overlapping = await tx.railwayRule.findFirst({
    where: {
      ruleKey,
      status: "ACTIVE",
      // existing.from < new.to  AND  (existing.to is null OR existing.to > new.from)
      ...(to ? { effectiveFrom: { lt: to } } : {}),
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }],
    },
    select: { id: true },
  });
  if (overlapping) {
    throw new AppError(409, "RULE_OVERLAP", `An active "${ruleKey}" rule already covers part of this period.`, {
      conflictingRuleId: overlapping.id,
    });
  }
}
