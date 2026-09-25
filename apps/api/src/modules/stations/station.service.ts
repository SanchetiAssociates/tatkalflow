import { createHash } from "node:crypto";
import {
  buildStationIndex,
  normaliseText,
  searchStations,
  stationDatasetMetaSchema,
  stationRecordSchema,
  type StationDatasetMeta,
  type StationDto,
  type StationIndex,
  type StationRecord,
  type StationRecordInput,
} from "@tatkalflow/shared";
import type { Db, Prisma } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { AppError, Errors } from "../../lib/errors.js";
import { AuditActions, type AuditService } from "../audit/audit.service.js";

export interface ImportOptions {
  /** Allow datasets under MIN_DATASET_SIZE (tests / regional subsets). */
  allowSmall?: boolean;
  /** Allow deactivating more than MAX_DROP_RATIO of current stations. */
  force?: boolean;
}

export interface ImportReport {
  version: string;
  status: "imported" | "unchanged";
  total: number;
  created: number;
  updated: number;
  deactivated: number;
  rejected: Array<{ row: number; reason: string }>;
}

type IndexedStation = StationDto & { aliases: string[] };

/** A real national dataset has thousands of stations; guard against importing a stub by mistake. */
export const MIN_DATASET_SIZE = 1000;
const MAX_DROP_RATIO = 0.2;
const INDEX_TTL_MS = 60_000;
const CHUNK = 500;

export class StationService {
  private index: { version: string | null; at: number; index: StationIndex<IndexedStation> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async activeDataset() {
    return this.db.stationDataset.findFirst({ where: { status: "ACTIVE" }, orderBy: { importedAt: "desc" } });
  }

  private async getIndex(): Promise<{ version: string | null; index: StationIndex<IndexedStation> }> {
    const now = this.clock.now().getTime();
    if (this.index && now - this.index.at < INDEX_TTL_MS) return this.index;
    const dataset = await this.activeDataset();
    const rows = await this.db.station.findMany({
      where: { isActive: true },
      select: { code: true, name: true, state: true, aliases: true },
    });
    const stations = rows.map((r) => ({ code: r.code, name: r.name, state: r.state, aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [] }));
    this.index = { version: dataset?.version ?? null, at: now, index: buildStationIndex(stations) };
    return this.index;
  }

  invalidate() {
    this.index = null;
  }

  async search(q: string, limit: number): Promise<{ datasetVersion: string | null; results: StationDto[] }> {
    const { version, index } = await this.getIndex();
    return {
      datasetVersion: version,
      results: searchStations(index, q, limit).map(({ station }) => ({ code: station.code, name: station.name, state: station.state })),
    };
  }

  async requireActive(codes: string[]): Promise<Map<string, StationDto>> {
    const rows = await this.db.station.findMany({ where: { code: { in: codes }, isActive: true }, select: { code: true, name: true, state: true } });
    const map = new Map(rows.map((r) => [r.code, r]));
    const missing = codes.filter((c) => !map.has(c));
    if (missing.length) throw new AppError(400, "UNKNOWN_STATION", "Choose stations from the list.", { stationCodes: missing });
    return map;
  }

  // ── Favourites & recents ──────────────────────────────────────────

  async mine(userId: string) {
    const rows = await this.db.userStation.findMany({
      where: { userId, OR: [{ isFavourite: true }, { lastUsedAt: { not: null } }] },
      orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }],
      take: 50,
    });
    const stations = await this.db.station.findMany({
      where: { code: { in: rows.map((r) => r.stationCode) } },
      select: { code: true, name: true, state: true, isActive: true },
    });
    const byCode = new Map(stations.map((s) => [s.code, s]));
    const dto = (code: string) => {
      const s = byCode.get(code);
      return s ? { code: s.code, name: s.name, state: s.state, isActive: s.isActive } : null;
    };
    return {
      favourites: rows.filter((r) => r.isFavourite).map((r) => dto(r.stationCode)).filter((s) => s !== null),
      recents: rows.filter((r) => r.lastUsedAt).slice(0, 8).map((r) => dto(r.stationCode)).filter((s) => s !== null),
    };
  }

  async setFavourite(userId: string, code: string, isFavourite: boolean) {
    if (isFavourite) await this.requireActive([code]);
    await this.db.userStation.upsert({
      where: { userId_stationCode: { userId, stationCode: code } },
      create: { userId, stationCode: code, isFavourite },
      update: { isFavourite },
    });
  }

  async recordUse(userId: string, codes: string[], tx: Prisma.TransactionClient | Db = this.db) {
    const now = this.clock.now();
    for (const code of new Set(codes)) {
      await tx.userStation.upsert({
        where: { userId_stationCode: { userId, stationCode: code } },
        create: { userId, stationCode: code, useCount: 1, lastUsedAt: now },
        update: { useCount: { increment: 1 }, lastUsedAt: now },
      });
    }
  }

  // ── Import ───────────────────────────────────────────────────────

  /**
   * Import a complete station dataset.
   *  - Every record is validated; any invalid or duplicate record aborts the import.
   *  - Identical content (checksum) is a no-op.
   *  - Stations missing from the new dataset are deactivated, never deleted.
   *  - Guards against stub datasets and accidental mass removal.
   */
  async importDataset(inputs: StationRecordInput[], metaInput: StationDatasetMeta, opts: ImportOptions = {}): Promise<ImportReport> {
    const meta = stationDatasetMetaSchema.parse(metaInput);
    const rejected: ImportReport["rejected"] = [];
    const records: StationRecord[] = [];
    const seen = new Map<string, number>();
    inputs.forEach((input, i) => {
      const parsed = stationRecordSchema.safeParse(input);
      if (!parsed.success) {
        rejected.push({ row: i + 1, reason: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
        return;
      }
      const prior = seen.get(parsed.data.code);
      if (prior !== undefined) {
        rejected.push({ row: i + 1, reason: `duplicate code ${parsed.data.code} (first at row ${prior})` });
        return;
      }
      seen.set(parsed.data.code, i + 1);
      records.push(parsed.data);
    });
    const base = { version: meta.version, total: inputs.length, created: 0, updated: 0, deactivated: 0, rejected };
    if (rejected.length) {
      throw new AppError(400, "STATION_IMPORT_INVALID", `${rejected.length} invalid record(s); nothing was imported.`, { rejected: rejected.slice(0, 50) });
    }
    if (records.length < MIN_DATASET_SIZE && !opts.allowSmall) {
      throw new AppError(400, "STATION_IMPORT_TOO_SMALL", `Only ${records.length} stations. A full dataset is expected (≥${MIN_DATASET_SIZE}); pass allowSmall for a subset.`);
    }

    records.sort((a, b) => a.code.localeCompare(b.code));
    const checksum = createHash("sha256").update(JSON.stringify(records)).digest("hex");
    const current = await this.activeDataset();
    if (current?.checksum === checksum) return { ...base, status: "unchanged" };
    if (await this.db.stationDataset.findUnique({ where: { version: meta.version } })) {
      throw new AppError(409, "STATION_VERSION_EXISTS", `Dataset version ${meta.version} already exists with different content. Use a new version.`);
    }

    const existing = await this.db.station.findMany({ select: { code: true, name: true, state: true, zone: true, aliases: true, isActive: true } });
    const existingByCode = new Map(existing.map((s) => [s.code, s]));
    const incoming = new Set(records.map((r) => r.code));
    const toDeactivate = existing.filter((s) => s.isActive && !incoming.has(s.code)).map((s) => s.code);
    const activeCount = existing.filter((s) => s.isActive).length;
    if (activeCount > 0 && toDeactivate.length / activeCount > MAX_DROP_RATIO && !opts.force) {
      throw new AppError(
        409,
        "STATION_IMPORT_MASS_REMOVAL",
        `This dataset would deactivate ${toDeactivate.length} of ${activeCount} stations. Re-run with force if intended.`,
      );
    }

    const searchText = (r: StationRecord) => normaliseText([r.code, r.name, ...r.aliases].join(" ")).slice(0, 400);
    const toCreate = records.filter((r) => !existingByCode.has(r.code));
    const toUpdate = records.filter((r) => {
      const e = existingByCode.get(r.code);
      return e && (e.name !== r.name || e.state !== r.state || e.zone !== r.zone || !e.isActive || JSON.stringify(e.aliases) !== JSON.stringify(r.aliases));
    });
    const now = this.clock.now();

    await this.db.$transaction(
      async (tx) => {
        for (let i = 0; i < toCreate.length; i += CHUNK) {
          await tx.station.createMany({
            data: toCreate.slice(i, i + CHUNK).map((r) => ({
              code: r.code,
              name: r.name,
              state: r.state,
              zone: r.zone,
              aliases: r.aliases,
              searchText: searchText(r),
              datasetVersion: meta.version,
            })),
          });
        }
        for (const r of toUpdate) {
          await tx.station.update({
            where: { code: r.code },
            data: { name: r.name, state: r.state, zone: r.zone, aliases: r.aliases, searchText: searchText(r), isActive: true, datasetVersion: meta.version },
          });
        }
        await tx.station.updateMany({ where: { code: { in: records.map((r) => r.code) } }, data: { datasetVersion: meta.version } });
        if (toDeactivate.length) await tx.station.updateMany({ where: { code: { in: toDeactivate } }, data: { isActive: false } });
        await tx.stationDataset.updateMany({ where: { status: "ACTIVE" }, data: { status: "ARCHIVED" } });
        const ds = await tx.stationDataset.create({
          data: {
            version: meta.version,
            source: meta.source,
            sourceUrl: meta.sourceUrl ?? null,
            license: meta.license ?? null,
            notes: meta.notes ?? null,
            recordCount: records.length,
            checksum,
            importedAt: now,
          },
        });
        await this.audit.record(
          {
            action: AuditActions.STATION_DATASET_IMPORTED,
            actorType: "SYSTEM",
            entityType: "station_dataset",
            entityId: ds.id,
            metadata: { version: meta.version, records: records.length, created: toCreate.length, updated: toUpdate.length, deactivated: toDeactivate.length },
          },
          tx,
        );
      },
      { timeout: 120_000 },
    );
    this.invalidate();
    return { ...base, status: "imported", created: toCreate.length, updated: toUpdate.length, deactivated: toDeactivate.length };
  }

  static notFound() {
    return Errors.notFound("Station not found.");
  }
}
