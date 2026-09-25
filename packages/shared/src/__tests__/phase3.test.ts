import { describe, expect, it } from "vitest";
import {
  buildStationIndex,
  editDistance,
  journeyDraftSchema,
  normaliseText,
  passengerInputSchema,
  passengerUpdateSchema,
  searchStations,
  stationRecordSchema,
  todayInIndia,
} from "../index.js";

// Test-only sample. Not a dataset; the app never seeds from this.
const SAMPLE = buildStationIndex([
  { code: "BCT", name: "Mumbai Central", state: "Maharashtra", aliases: ["Bombay Central"] },
  { code: "CSMT", name: "Chhatrapati Shivaji Maharaj Terminus", state: "Maharashtra", aliases: ["Mumbai CST", "Victoria Terminus"] },
  { code: "NDLS", name: "New Delhi", state: "Delhi" },
  { code: "DLI", name: "Delhi Junction", state: "Delhi" },
  { code: "ADI", name: "Ahmedabad Junction", state: "Gujarat" },
  { code: "MAO", name: "Madgaon", state: "Goa" },
  { code: "HWH", name: "Howrah Junction", state: "West Bengal" },
  { code: "SBC", name: "KSR Bengaluru", state: "Karnataka", aliases: ["Bangalore City"] },
]);
const top = (q: string) => searchStations(SAMPLE, q)[0]?.station.code;

describe("station search", () => {
  it("ranks exact codes first", () => {
    expect(top("ndls")).toBe("NDLS");
    expect(top("BCT")).toBe("BCT");
  });
  it("matches name prefixes and word prefixes", () => {
    expect(top("mumbai c")).toBe("BCT");
    expect(top("new del")).toBe("NDLS");
    expect(searchStations(SAMPLE, "delhi").map((m) => m.station.code)).toEqual(expect.arrayContaining(["NDLS", "DLI"]));
  });
  it("finds stations by old names / aliases", () => {
    expect(top("bombay")).toBe("BCT");
    expect(top("bangalore")).toBe("SBC");
    expect(searchStations(SAMPLE, "bombay")[0]!.matchedAlias).toBe(true);
  });
  it("tolerates typos", () => {
    expect(top("mumbia")).toBe("BCT"); // transposition
    expect(top("ahmadabad")).toBe("ADI"); // substitution
    expect(top("hwora")).toBe("HWH");
    expect(top("madgoan")).toBe("MAO");
  });
  it("does not fuzz very short tokens into noise", () => {
    expect(searchStations(SAMPLE, "xq")).toEqual([]);
  });
  it("ignores accents, punctuation and case", () => {
    expect(normaliseText("  Bengalūru-City! ")).toBe("bengaluru city");
    expect(top("BENGALURU")).toBe("SBC");
  });
  it("handles empty or hostile input safely", () => {
    expect(searchStations(SAMPLE, "   ")).toEqual([]);
    expect(searchStations(SAMPLE, "<script>alert(1)</script>")).toEqual([]);
    expect(searchStations(SAMPLE, "a".repeat(500))).toEqual([]);
  });
  it("respects the limit", () => {
    expect(searchStations(SAMPLE, "a", 2).length).toBeLessThanOrEqual(2);
  });
  it("edit distance is bounded", () => {
    expect(editDistance("mumbai", "mumbia", 2)).toBe(1);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });
});

describe("station records", () => {
  it("normalises codes to upper case and rejects bad codes", () => {
    expect(stationRecordSchema.parse({ code: " ndls ", name: "New Delhi" }).code).toBe("NDLS");
    expect(stationRecordSchema.safeParse({ code: "N D", name: "x y" }).success).toBe(false);
    expect(stationRecordSchema.safeParse({ code: "TOOLONGCODE", name: "New Delhi" }).success).toBe(false);
  });
});

describe("passenger schema", () => {
  const ok = { name: "Siddharth", age: 39, gender: "MALE" };
  it("applies defaults", () => {
    expect(passengerInputSchema.parse(ok)).toMatchObject({ berthPreference: "NO_PREFERENCE", foodPreference: "NO_PREFERENCE", seniorCitizenOptIn: false });
  });
  it("accepts names in Indian scripts", () => {
    expect(passengerInputSchema.parse({ ...ok, name: "सिद्धार्थ" }).name).toBe("सिद्धार्थ");
  });
  it("rejects markup and digits in names", () => {
    expect(passengerInputSchema.safeParse({ ...ok, name: "<img src=x onerror=alert(1)>" }).success).toBe(false);
    expect(passengerInputSchema.safeParse({ ...ok, name: "R2D2" }).success).toBe(false);
  });
  it("validates ages", () => {
    expect(passengerInputSchema.safeParse({ ...ok, age: -1 }).success).toBe(false);
    expect(passengerInputSchema.safeParse({ ...ok, age: 7.5 }).success).toBe(false);
    expect(passengerInputSchema.safeParse({ ...ok, age: 126 }).success).toBe(false);
  });
  it("partial updates never re-apply defaults to fields that weren't sent", () => {
    expect(passengerUpdateSchema.parse({ foodPreference: "VEG" })).toEqual({ foodPreference: "VEG" });
  });
  it("refuses identity-document and unknown fields", () => {
    expect(passengerInputSchema.safeParse({ ...ok, aadhaar: "1234" }).success).toBe(false);
    expect(passengerUpdateSchema.safeParse({ idNumber: "X" }).success).toBe(false);
  });
});

describe("journey draft schema", () => {
  const id = "3f1c1e0e-4c1c-4e0f-9d8a-0e4b3b2a1c0d";
  it("requires different stations", () => {
    expect(journeyDraftSchema.safeParse({ fromStationCode: "BCT", toStationCode: "bct", journeyDate: "2026-10-25", passengerIds: [id] }).success).toBe(false);
  });
  it("rejects impossible dates and duplicate passengers", () => {
    expect(journeyDraftSchema.safeParse({ fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-02-30", passengerIds: [id] }).success).toBe(false);
    expect(journeyDraftSchema.safeParse({ fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [id, id] }).success).toBe(false);
  });
  it("computes today's date in IST", () => {
    expect(todayInIndia(new Date("2026-09-24T19:00:00Z"))).toBe("2026-09-25"); // 00:30 IST
    expect(todayInIndia(new Date("2026-09-24T18:00:00Z"))).toBe("2026-09-24"); // 23:30 IST
  });
});
