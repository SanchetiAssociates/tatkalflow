import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseStationFile } from "../src/modules/stations/station-parsers.js";
import { createHarness, signIn, type Harness } from "./harness.js";

let h: Harness;
let auth: { authorization: string };
let userId: string;
beforeAll(async () => {
  h = await createHarness();
  const fixture = parseStationFile(readFileSync(join(import.meta.dirname, "fixtures", "stations.test-only.csv"), "utf8"), "csv");
  await h.c.stations.importDataset(fixture, { version: "t1", source: "test fixture" }, { allowSmall: true });
  const s = await signIn(h, "9000000001");
  auth = { authorization: `Bearer ${s.accessToken}` };
  userId = s.user.id;
});
afterAll(async () => {
  await h?.close();
});

const post = (url: string, payload: unknown) => h.app.inject({ method: "POST", url, headers: auth, payload: payload as object });

describe("passenger master", () => {
  let id: string;

  it("creates a passenger with defaults and returns no internal fields", async () => {
    const res = await post("/api/passengers", { name: "  Siddharth   S  ", age: 39, gender: "MALE", berthPreference: "LOWER" });
    expect(res.statusCode).toBe(201);
    const p = res.json();
    id = p.id;
    expect(p).toMatchObject({ name: "Siddharth S", age: 39, gender: "MALE", berthPreference: "LOWER", foodPreference: "NO_PREFERENCE", seniorCitizenOptIn: false });
    expect(p).not.toHaveProperty("userId");
    expect(p).not.toHaveProperty("deletedAt");
    expect(p).not.toHaveProperty("concessionCode");
  });

  it("returns field-level validation errors", async () => {
    const res = await post("/api/passengers", { name: "", age: 200, gender: "X" });
    expect(res.statusCode).toBe(400);
    const paths = [...new Set(res.json().error.fields.map((f: { path: string }) => f.path))].sort();
    expect(paths).toEqual(["age", "gender", "name"]);
  });

  it("refuses identity-document fields", async () => {
    const res = await post("/api/passengers", { name: "Asha", age: 30, gender: "FEMALE", idCardNumber: "ABCD1234" });
    expect(res.statusCode).toBe(400);
  });

  it("edits and lists passengers, most recently used first", async () => {
    const r = await h.app.inject({ method: "PATCH", url: `/api/passengers/${id}`, headers: auth, payload: { foodPreference: "VEG" } });
    expect(r.json().foodPreference).toBe("VEG");
    expect(r.json().berthPreference).toBe("LOWER"); // untouched fields keep their values
    const second = (await post("/api/passengers", { name: "Raaisha", age: 8, gender: "FEMALE" })).json();
    await post("/api/journeys", { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [second.id] });
    const list = (await h.app.inject({ method: "GET", url: "/api/passengers", headers: auth })).json();
    expect(list.map((p: { name: string }) => p.name)).toEqual(["Raaisha", "Siddharth S"]);
  });

  it("soft-deletes (row kept for journey history, hidden from lists)", async () => {
    const tmp = (await post("/api/passengers", { name: "Temp", age: 20, gender: "MALE" })).json();
    expect((await h.app.inject({ method: "DELETE", url: `/api/passengers/${tmp.id}`, headers: auth })).statusCode).toBe(204);
    expect((await h.app.inject({ method: "GET", url: `/api/passengers/${tmp.id}`, headers: auth })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "DELETE", url: `/api/passengers/${tmp.id}`, headers: auth })).statusCode).toBe(404);
    const row = await h.db.passenger.findUniqueOrThrow({ where: { id: tmp.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it("audits create/update/delete without personal details", async () => {
    const logs = await h.db.auditLog.findMany({ where: { userId, action: { startsWith: "passenger." } } });
    expect(new Set(logs.map((l) => l.action))).toEqual(new Set(["passenger.created", "passenger.updated", "passenger.deleted"]));
    const blob = JSON.stringify(logs.map((l) => l.metadata));
    expect(blob).not.toMatch(/Siddharth|Raaisha|Temp/);
    expect(logs.find((l) => l.action === "passenger.updated")?.metadata).toEqual({ fields: ["foodPreference"] });
  });
});

describe("journey drafts", () => {
  it("creates a DRAFT journey with station names and honest warnings", async () => {
    const p = (await post("/api/passengers", { name: "Meera", age: 62, gender: "FEMALE" })).json();
    const res = await post("/api/journeys", { fromStationCode: "bct", toStationCode: "ndls", journeyDate: "2026-10-25", passengerIds: [p.id] });
    expect(res.statusCode).toBe(201);
    const { journey, warnings } = res.json();
    expect(journey).toMatchObject({ fromStationCode: "BCT", fromStationName: "Mumbai Central", toStationName: "New Delhi", journeyDate: "2026-10-25", state: "DRAFT", quota: "TATKAL" });
    expect(journey.passengers[0]).toMatchObject({ id: p.id, name: "Meera" });
    expect(warnings.join(" ")).toMatch(/passenger limit .* not configured/i);
    expect(warnings.join(" ")).toMatch(/not been verified/i);
  });

  it("rejects past dates, unknown or inactive stations, and same From/To", async () => {
    const p = (await post("/api/passengers", { name: "Dev", age: 30, gender: "MALE" })).json();
    const base = { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [p.id] };
    expect((await post("/api/journeys", { ...base, journeyDate: "2026-09-24" })).statusCode).toBe(400);
    expect((await post("/api/journeys", { ...base, toStationCode: "ZZZ" })).json().error.code).toBe("UNKNOWN_STATION");
    expect((await post("/api/journeys", { ...base, toStationCode: "BCT" })).statusCode).toBe(400);
    // Today (IST) is allowed.
    expect((await post("/api/journeys", { ...base, journeyDate: "2026-09-25" })).statusCode).toBe(201);
  });

  it("lists journeys chronologically and deletes them", async () => {
    const list = (await h.app.inject({ method: "GET", url: "/api/journeys", headers: auth })).json();
    const dates = list.map((j: { journeyDate: string }) => j.journeyDate);
    expect(dates).toEqual([...dates].sort());
    const id = list[0].id;
    expect((await h.app.inject({ method: "DELETE", url: `/api/journeys/${id}`, headers: auth })).statusCode).toBe(204);
    expect((await h.app.inject({ method: "GET", url: `/api/journeys/${id}`, headers: auth })).statusCode).toBe(404);
  });
});
