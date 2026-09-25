import { isDeepStrictEqual } from "node:util";
import {
  CRITICAL_RULE_KEYS,
  isRuleKey,
  railwayRuleSchema,
  ruleValueSchemas,
  type RailwayRuleInput,
  type RuleKey,
  type RuleValue,
  type RuleVerificationStatus,
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
  sourceUrl: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  lastVerifiedAt: Date | null;
  verifiedBy: string | null;
  verificationStatus: RuleVerificationStatus;
  /** Checked against an official source and still within its effective period. */
  isVerified: boolean;
  /** Verified, but longer ago than the re-verification interval. */
  needsReverification: boolean;
}

export interface RulesPolicy {
  /** When true, critical rules must be VERIFIED or the app refuses to use them. */
  enforceVerification: boolean;
  reverifyAfterDays: number;
}

export interface SyncReport {
  created: string[];
  updated: string[];
  unchanged: number;
  /** ACTIVE rows in the database that are not in the registry file. */
  unmanaged: string[];
}

const CACHE_TTL_MS = 60_000;

/**
 * Single source of truth for railway regulations at runtime.
 *
 * - Values come from the source-controlled registry (rules/railway-rules.json)
 *   via `syncFromRegistry`; changing a rule is a reviewed data change.
 * - Resolution: the ACTIVE row whose [effectiveFrom, effectiveTo) contains the
 *   instant. ACTIVE periods per key never overlap.
 * - "Exists" and "verified" are separate: `get` returns any ACTIVE rule with its
 *   verification state; `getForBooking` refuses unverified *critical* rules
 *   when verification is enforced (always, in production).
 */
export class RailwayRulesService {
  private cache: { at: number; rows: ResolvedRule[] } | null = null;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly policy: RulesPolicy,
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  private toResolved(row: Prisma.RailwayRuleGetPayload<object>, now: Date): ResolvedRule | null {
    if (!isRuleKey(row.ruleKey)) return null; // unknown keys are ignored, not trusted
    const parsed = ruleValueSchemas[row.ruleKey].safeParse(row.value);
    if (!parsed.success) return null; // an invalid row must never be used
    const verifiedEvidence = Boolean(row.lastVerifiedAt && row.sourceUrl && row.verifiedBy);
    // A SUPERSEDED row was verified for its (now closed) period; it still counts
    // as verified for instants inside that period.
    const isVerified = verifiedEvidence && (row.verificationStatus === "VERIFIED" || row.verificationStatus === "SUPERSEDED");
    const ageDays = row.lastVerifiedAt ? (now.getTime() - row.lastVerifiedAt.getTime()) / 86_400_000 : Infinity;
    return {
      id: row.id,
      ruleKey: row.ruleKey,
      value: parsed.data,
      source: row.source,
      sourceUrl: row.sourceUrl,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      lastVerifiedAt: row.lastVerifiedAt,
      verifiedBy: row.verifiedBy,
      verificationStatus: row.verificationStatus,
      isVerified,
      needsReverification: isVerified && ageDays > this.policy.reverifyAfterDays,
    } as ResolvedRule;
  }

  private async activeRows(): Promise<ResolvedRule[]> {
    const now = this.clock.now();
    if (this.cache && now.getTime() - this.cache.at < CACHE_TTL_MS) return this.cache.rows;
    const rows = await this.db.railwayRule.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ ruleKey: "asc" }, { effectiveFrom: "desc" }],
    });
    const resolved = rows.map((r) => this.toResolved(r, now)).filter((r): r is ResolvedRule => r !== null);
    this.cache = { at: now.getTime(), rows: resolved };
    return resolved;
  }

  async find<K extends RuleKey>(key: K, at: Date = this.clock.now()): Promise<ResolvedRule<K> | null> {
    const t = at.getTime();
    const match = (await this.activeRows()).find(
      (r) => r.ruleKey === key && r.effectiveFrom.getTime() <= t && (r.effectiveTo === null || r.effectiveTo.getTime() > t),
    );
    return (match as ResolvedRule<K> | undefined) ?? null;
  }

  /** The rule in force at `at`, verified or not. Throws if none is configured. */
  async get<K extends RuleKey>(key: K, at: Date = this.clock.now()): Promise<ResolvedRule<K>> {
    const rule = await this.find(key, at);
    if (!rule) throw Errors.ruleNotConfigured(key);
    return rule;
  }

  /**
   * For anything that decides booking timing or eligibility. Critical rules
   * must be verified when enforcement is on; the caller always receives the
   * verification state so the UI can say "timing not yet verified".
   */
  async getForBooking<K extends RuleKey>(key: K, at: Date = this.clock.now()): Promise<ResolvedRule<K>> {
    const rule = await this.get(key, at);
    if (this.policy.enforceVerification && CRITICAL_RULE_KEYS.includes(key) && !rule.isVerified) {
      throw new AppError(503, "RULE_UNVERIFIED", "Booking rules are awaiting verification. Please try again later.", { ruleKey: key });
    }
    return rule;
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

  /** Critical rules that are missing or unverified right now (for health/admin). */
  async verificationGaps(at: Date = this.clock.now()) {
    const snap = await this.snapshot(at);
    return CRITICAL_RULE_KEYS.map((key) => {
      const r = snap[key];
      return { ruleKey: key, state: !r ? "MISSING" : r.isVerified ? (r.needsReverification ? "STALE" : "OK") : "UNVERIFIED" };
    }).filter((g) => g.state !== "OK");
  }

  /**
   * Apply the source-controlled registry. Values are immutable per
   * (ruleKey, effectiveFrom); only metadata, effectiveTo and verification
   * fields may change on an existing entry. Nothing is deleted.
   */
  async syncFromRegistry(entries: RailwayRuleInput[]): Promise<SyncReport> {
    const parsed = entries.map((e) => railwayRuleSchema.parse(e));
    const report: SyncReport = { created: [], updated: [], unchanged: 0, unmanaged: [] };

    // Updates first, so an entry whose effectiveTo was closed makes room for
    // its successor before the successor is created.
    const existingByEntry = await Promise.all(
      parsed.map((rule) =>
        this.db.railwayRule.findUnique({
          where: { ruleKey_effectiveFrom: { ruleKey: rule.ruleKey, effectiveFrom: new Date(rule.effectiveFrom) } },
        }),
      ),
    );

    for (const [i, rule] of parsed.entries()) {
      const existing = existingByEntry[i];
      if (!existing) continue;
      const label = `${rule.ruleKey}@${rule.effectiveFrom}`;
      if (!isDeepStrictEqual(existing.value, rule.value)) {
        throw new AppError(409, "RULE_VALUE_IMMUTABLE", `${label}: values are immutable. Close this entry's effectiveTo and add a new entry.`);
      }
      const next = {
        source: rule.source,
        sourceUrl: rule.sourceUrl ?? null,
        effectiveTo: rule.effectiveTo ? new Date(rule.effectiveTo) : null,
        lastVerifiedAt: rule.lastVerifiedAt ? new Date(rule.lastVerifiedAt) : null,
        verifiedBy: rule.verifiedBy ?? null,
        verificationStatus: rule.verificationStatus,
        status: rule.status,
        notes: rule.notes ?? null,
      };
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => {
        const a = existing[k] instanceof Date ? (existing[k] as Date).getTime() : existing[k];
        const b = next[k] instanceof Date ? (next[k] as Date).getTime() : next[k];
        return a !== b;
      });
      if (changed.length === 0) {
        report.unchanged++;
        continue;
      }
      await this.db.$transaction(async (tx) => {
        if (next.status === "ACTIVE") {
          await assertNoOverlap(tx, rule.ruleKey, existing.effectiveFrom, next.effectiveTo, existing.id);
        }
        await tx.railwayRule.update({ where: { id: existing.id }, data: next });
        await this.audit.record(
          {
            action: AuditActions.RULE_CHANGED,
            actorType: "SYSTEM",
            entityType: "railway_rule",
            entityId: existing.id,
            metadata: { ruleKey: rule.ruleKey, changedFields: changed, verificationStatus: next.verificationStatus },
          },
          tx,
        );
      });
      report.updated.push(label);
    }

    for (const [i, rule] of parsed.entries()) {
      if (existingByEntry[i]) continue;
      const effectiveFrom = new Date(rule.effectiveFrom);
      const effectiveTo = rule.effectiveTo ? new Date(rule.effectiveTo) : null;
      await this.db.$transaction(async (tx) => {
        if (rule.status === "ACTIVE") await assertNoOverlap(tx, rule.ruleKey, effectiveFrom, effectiveTo);
        const row = await tx.railwayRule.create({
          data: {
            ruleKey: rule.ruleKey,
            value: rule.value as Prisma.InputJsonValue,
            source: rule.source,
            sourceUrl: rule.sourceUrl ?? null,
            effectiveFrom,
            effectiveTo,
            lastVerifiedAt: rule.lastVerifiedAt ? new Date(rule.lastVerifiedAt) : null,
            verifiedBy: rule.verifiedBy ?? null,
            verificationStatus: rule.verificationStatus,
            status: rule.status,
            notes: rule.notes ?? null,
          },
        });
        await this.audit.record(
          {
            action: AuditActions.RULE_CHANGED,
            actorType: "SYSTEM",
            entityType: "railway_rule",
            entityId: row.id,
            metadata: { ruleKey: row.ruleKey, value: rule.value, verificationStatus: row.verificationStatus, created: true },
          },
          tx,
        );
      });
      report.created.push(`${rule.ruleKey}@${rule.effectiveFrom}`);
    }

    const managed = new Set(parsed.map((r) => `${r.ruleKey}@${new Date(r.effectiveFrom).toISOString()}`));
    const active = await this.db.railwayRule.findMany({ where: { status: "ACTIVE" }, select: { ruleKey: true, effectiveFrom: true } });
    report.unmanaged = active
      .map((r) => `${r.ruleKey}@${r.effectiveFrom.toISOString()}`)
      .filter((label) => !managed.has(label));

    await this.expireLapsed();
    this.invalidate();
    return report;
  }

  /** VERIFIED rows whose effective period has ended become EXPIRED. */
  async expireLapsed(at: Date = this.clock.now()): Promise<number> {
    const result = await this.db.railwayRule.updateMany({
      where: { verificationStatus: "VERIFIED", effectiveTo: { lte: at } },
      data: { verificationStatus: "EXPIRED" },
    });
    if (result.count) this.invalidate();
    return result.count;
  }
}

async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  ruleKey: string,
  from: Date,
  to: Date | null,
  excludeId?: string,
) {
  const overlapping = await tx.railwayRule.findFirst({
    where: {
      ruleKey,
      status: "ACTIVE",
      ...(excludeId ? { id: { not: excludeId } } : {}),
      // existing.from < new.to  AND  (existing.to is null OR existing.to > new.from)
      ...(to ? { effectiveFrom: { lt: to } } : {}),
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }],
    },
    select: { id: true, effectiveFrom: true },
  });
  if (overlapping) {
    throw new AppError(409, "RULE_OVERLAP", `An active "${ruleKey}" rule already covers part of this period.`, {
      conflictingRuleId: overlapping.id,
    });
  }
}
