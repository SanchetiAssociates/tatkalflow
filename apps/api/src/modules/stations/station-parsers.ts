import type { StationRecordInput } from "@tatkalflow/shared";

/**
 * Supported import formats:
 *  - CSV with header: code,name[,state][,zone][,aliases]   (aliases separated by "|")
 *  - JSON array of { code, name, state?, zone?, aliases? }
 *  - GeoJSON FeatureCollection whose features carry those fields in `properties`
 */
export function parseStationFile(content: string, format: "csv" | "json"): StationRecordInput[] {
  return format === "csv" ? parseCsv(content) : parseJson(content);
}

function parseJson(content: string): StationRecordInput[] {
  const doc = JSON.parse(content) as unknown;
  if (Array.isArray(doc)) return doc as StationRecordInput[];
  if (doc && typeof doc === "object" && (doc as { type?: string }).type === "FeatureCollection") {
    const features = (doc as { features?: Array<{ properties?: Record<string, unknown> }> }).features ?? [];
    return features.map((f) => {
      const p = f.properties ?? {};
      return {
        code: String(p.code ?? ""),
        name: String(p.name ?? ""),
        state: (p.state as string | null | undefined) ?? null,
        zone: (p.zone as string | null | undefined) ?? null,
      };
    });
  }
  throw new Error("JSON must be an array of stations or a GeoJSON FeatureCollection");
}

/** RFC 4180 CSV: quoted fields, escaped quotes (""), CRLF or LF. */
export function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function parseCsv(content: string): StationRecordInput[] {
  const [header, ...rows] = parseCsvRows(content.replace(/^﻿/, ""));
  if (!header) return [];
  const cols = header.map((h) => h.trim().toLowerCase());
  const idx = (name: string) => cols.indexOf(name);
  if (idx("code") < 0 || idx("name") < 0) throw new Error('CSV header must include "code" and "name"');
  return rows.map((r) => {
    const get = (name: string) => (idx(name) >= 0 ? (r[idx(name)] ?? "").trim() : "");
    const aliases = get("aliases");
    return {
      code: get("code"),
      name: get("name"),
      state: get("state") || null,
      zone: get("zone") || null,
      aliases: aliases ? aliases.split("|").map((a) => a.trim()).filter(Boolean) : [],
    };
  });
}
