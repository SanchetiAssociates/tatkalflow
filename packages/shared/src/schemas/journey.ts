import { z } from "zod";
import { stationCodeSchema } from "./station.js";

/** YYYY-MM-DD calendar date (a journey date has no time or timezone). */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "Not a real date");

/** Today's date in India, as YYYY-MM-DD. */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Minimal journey draft (Phase 3). Trains, classes, preferences and Tatkal
 * scheduling are added in Phase 4+. Server-side checks (station exists,
 * passengers owned, date not in the past) happen in the API.
 */
export const journeyDraftSchema = z
  .object({
    fromStationCode: stationCodeSchema,
    toStationCode: stationCodeSchema,
    journeyDate: calendarDateSchema,
    passengerIds: z
      .array(z.uuid())
      .min(1, "Select at least one passenger")
      .max(12, "Too many passengers")
      .refine((ids) => new Set(ids).size === ids.length, "A passenger is selected twice"),
  })
  .strict()
  .refine((j) => j.fromStationCode !== j.toStationCode, { path: ["toStationCode"], message: "From and To must be different" });
export type JourneyDraftInput = z.input<typeof journeyDraftSchema>;
