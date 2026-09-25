import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { parseStationFile } from "../src/modules/stations/station-parsers.js";
import { MOCK_TRAINS, MockTrainDataProvider, NoTrainDataProvider, servesRoute } from "../src/modules/trains/train-provider.js";
import { createHarness, signIn, type Harness } from "./harness.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET: "a".repeat(40),
  OTP_HASH_PEPPER: "b".repeat(40),
  IP_HASH_PEPPER: "c".repeat(40),
};

describe("train data provider config", () => {
  it("refuses the mock provider in production and defaults to none there", () => {
    const prod = { ...base, NODE_ENV: "production", OTP_PROVIDER: "msg91" };
    expect(() => loadConfig({ ...prod, TRAIN_DATA_PROVIDER: "mock" })).toThrow(/mock train data provider/);
    expect(loadConfig(prod).trainDataProvider).toBe("none");
    expect(loadConfig({ ...base, NODE_ENV: "development" }).trainDataProvider).toBe("mock");
    expect(() => loadConfig({ ...base, TRAIN_DATA_PROVIDER: "irctc-scraper" })).toThrow(/TRAIN_DATA_PROVIDER/);
  });
});

describe("MockTrainDataProvider", () => {
  it("holds only clearly fictional sample trains", () => {
    for (const t of MOCK_TRAINS) {
      expect(t.number).toMatch(/^90\d{3}$/);
      expect(t.name).toMatch(/^Sample /);
      expect(t.stops[0]).toBe(t.fromStationCode);
      expect(t.stops.at(-1)).toBe(t.toStationCode);
    }
  });

  it("finds trains by number prefix or name and knows their direction", async () => {
    const p = new MockTrainDataProvider();
    expect((await p.search("90104")).map((t) => t.number)).toEqual(["90104"]);
    expect((await p.search("deccan")).map((t) => t.number)).toEqual(["90104"]);
    expect(servesRoute(await p.findByNumber("90101"), "BCT", "NDLS")).toBe(true);
    expect(servesRoute(await p.findByNumber("90101"), "NDLS", "BCT")).toBe(false); // wrong direction
    expect(servesRoute(null, "BCT", "NDLS")).toBeNull();
  });
});

describe("without train data (provider: none)", () => {
  let h: Harness;
  let auth: { authorization: string };
  beforeAll(async () => {
    h = await createHarness({ TRAIN_DATA_PROVIDER: "none" });
    const fixture = parseStationFile(readFileSync(join(import.meta.dirname, "fixtures", "stations.test-only.csv"), "utf8"), "csv");
    await h.c.stations.importDataset(fixture, { version: "t1", source: "test fixture" }, { allowSmall: true });
    auth = { authorization: `Bearer ${(await signIn(h, "9000000601")).accessToken}` };
  });
  afterAll(async () => {
    await h?.close();
  });

  it("search is empty and says so; numbers are stored as entered, without a name", async () => {
    expect(new NoTrainDataProvider().available).toBe(false);
    const search = (await h.app.inject({ method: "GET", url: "/api/trains/search?q=12951", headers: auth })).json();
    expect(search).toEqual({ provider: "none", available: false, results: [] });
    const p = (await h.app.inject({ method: "POST", url: "/api/passengers", headers: auth, payload: { name: "Asha", age: 28, gender: "FEMALE" } })).json();
    const res = await h.app.inject({
      method: "POST",
      url: "/api/journeys",
      headers: auth,
      payload: { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [p.id], trains: ["12951"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().journey.trains).toEqual([{ priority: 1, trainNumber: "12951", trainName: null }]);
  });
});
