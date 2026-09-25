import { z } from "zod";

export const stationCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,8}$/, "Invalid station code");

/** One record in an importable station dataset (CSV row / JSON object / GeoJSON feature). */
export const stationRecordSchema = z.object({
  code: stationCodeSchema,
  name: z.string().trim().min(2).max(120),
  state: z.string().trim().max(64).nullish().transform((v) => v || null),
  zone: z.string().trim().max(16).nullish().transform((v) => v || null),
  aliases: z.array(z.string().trim().min(2).max(120)).max(10).default([]),
});
export type StationRecordInput = z.input<typeof stationRecordSchema>;
export type StationRecord = z.output<typeof stationRecordSchema>;

export const stationDatasetMetaSchema = z.object({
  version: z.string().trim().regex(/^[A-Za-z0-9._-]{1,32}$/, "Version: letters, digits, . _ - (max 32)"),
  source: z.string().trim().min(3).max(500),
  sourceUrl: z.url({ protocol: /^https$/ }).max(1000).nullish(),
  license: z.string().trim().max(200).nullish(),
  notes: z.string().max(2000).nullish(),
});
export type StationDatasetMeta = z.input<typeof stationDatasetMetaSchema>;

export const stationSearchQuerySchema = z.object({
  q: z.string().trim().min(1, "Type a station name or code").max(50),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export interface StationDto {
  code: string;
  name: string;
  state: string | null;
}
