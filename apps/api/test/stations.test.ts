import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsvRows, parseStationFile } from "../src/modules/stations/station-parsers.js";
import { createHarness, signIn, type Harness } from "./harness.js";

const FIXTURE = parseStationFile(readFileSync(join(import.meta.dirname, "fixtures", "stations.test-only.csv"), "utf8"), "csv");
const META = { version: "test-1", source: "TatkalFlow test fixture (not a real dataset)", license: "test-only" };

let h: Harness;
let auth: { authorization: string };
beforeAll(async () => {
  h = await createHarness();
  auth = { authorization: `Bearer ${(await signIn(h, "9123456780")).accessToken}` };
});
afterAll(async () => {
  await h?.close();
});

describe("station import", () => {
  it("reports 'not installed' before any dataset is imported", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/stations/dataset", headers: auth });
    expect(res.json()).toEqual({ installed: false });
  });

  it("refuses a stub dataset unless explicitly allowed", async () => {
    await expect(h.c.stations.importDataset(FIXTURE, META)).rejects.toMatchObject({ code: "STATION_IMPORT_TOO_SMALL" });
  });

  it("aborts the whole import if any record is invalid or duplicated", async () => {
    const bad = [...FIXTURE, { code: "B@D", name: "Bad" }, { code: "BCT", name: "Duplicate" }];
    const err = await h.c.stations.importDataset(bad, { ...META, version: "bad-1" }, { allowSmall: true }).catch((e) => e);
    expect(err.code).toBe("STATION_IMPORT_INVALID");
    expect(err.details.rejected).toHaveLength(2);
    expect(await h.db.station.count()).toBe(0);
  });

  it("imports with provenance and is idempotent", async () => {
    const report = await h.c.stations.importDataset(FIXTURE, META, { allowSmall: true });
    expect(report).toMatchObject({ status: "imported", created: FIXTURE.length, updated: 0, deactivated: 0 });
    const again = await h.c.stations.importDataset(FIXTURE, { ...META, version: "test-1b" }, { allowSmall: true });
    expect(again.status).toBe("unchanged");

    const ds = (await h.app.inject({ method: "GET", url: "/api/stations/dataset", headers: auth })).json();
    expect(ds).toMatchObject({ installed: true, version: "test-1", recordCount: FIXTURE.length, license: "test-only" });

    const audit = await h.db.auditLog.findFirst({ where: { action: "stations.dataset_imported" } });
    expect(audit?.metadata).toMatchObject({ version: "test-1", records: FIXTURE.length });
  });

  it("refuses to reuse a version for different content", async () => {
    const changed = FIXTURE.map((r) => (r.code === "PUNE" ? { ...r, name: "Pune Jn" } : r));
    await expect(h.c.stations.importDataset(changed, META, { allowSmall: true })).rejects.toMatchObject({ code: "STATION_VERSION_EXISTS" });
  });

  it("guards against mass removal, and deactivates (never deletes) dropped stations", async () => {
    const half = FIXTURE.slice(0, 6);
    await expect(h.c.stations.importDataset(half, { ...META, version: "test-2" }, { allowSmall: true })).rejects.toMatchObject({
      code: "STATION_IMPORT_MASS_REMOVAL",
    });
    const minusOne = FIXTURE.filter((r) => r.code !== "LKO");
    const report = await h.c.stations.importDataset(minusOne, { ...META, version: "test-3" }, { allowSmall: true });
    expect(report).toMatchObject({ status: "imported", deactivated: 1 });
    const lko = await h.db.station.findUniqueOrThrow({ where: { code: "LKO" } });
    expect(lko.isActive).toBe(false);
    const datasets = await h.db.stationDataset.findMany({ orderBy: { importedAt: "asc" } });
    expect(datasets.filter((d) => d.status === "ACTIVE").map((d) => d.version)).toEqual(["test-3"]);
  });

  it("parses quoted CSV and GeoJSON", () => {
    expect(parseCsvRows('code,name\n"X1","Name, with comma"\r\n"X2","Say ""hi"""\n')).toEqual([
      ["code", "name"],
      ["X1", "Name, with comma"],
      ["X2", 'Say "hi"'],
    ]);
    const geo = parseStationFile(JSON.stringify({ type: "FeatureCollection", features: [{ properties: { code: "ndls", name: "New Delhi", state: "Delhi" } }] }), "json");
    expect(geo).toEqual([{ code: "ndls", name: "New Delhi", state: "Delhi", zone: null }]);
  });
});

describe("station search API", () => {
  const search = (q: string, extra = "") => h.app.inject({ method: "GET", url: `/api/stations/search?q=${encodeURIComponent(q)}${extra}`, headers: auth });

  it("finds by code, name, alias and typo", async () => {
    expect((await search("ndls")).json().results[0].code).toBe("NDLS");
    expect((await search("bombay")).json().results[0].code).toBe("BCT");
    expect((await search("poona")).json().results[0].code).toBe("PUNE");
    expect((await search("ahmadabad")).json().results[0].code).toBe("ADI");
    expect((await search("ndls")).json().datasetVersion).toBe("test-3");
  });

  it("excludes deactivated stations", async () => {
    expect((await search("lucknow")).json().results).toEqual([]);
  });

  it("validates the query", async () => {
    expect((await search("")).statusCode).toBe(400);
    expect((await search("x".repeat(51))).statusCode).toBe(400);
    expect((await search("delhi", "&limit=100")).statusCode).toBe(400);
    expect((await search("delhi", "&limit=abc")).statusCode).toBe(400);
  });

  it("treats hostile input as plain text", async () => {
    for (const q of ["' OR 1=1 --", "<script>alert(1)</script>", "%00", "../../etc/passwd"]) {
      const res = await search(q);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
    }
    expect(await h.db.station.count()).toBe(FIXTURE.length);
  });

  it("requires sign-in", async () => {
    expect((await h.app.inject({ method: "GET", url: "/api/stations/search?q=delhi" })).statusCode).toBe(401);
  });
});

describe("favourites and recents", () => {
  it("adds and removes favourites; rejects unknown or inactive stations", async () => {
    expect((await h.app.inject({ method: "PUT", url: "/api/stations/favourites/ndls", headers: auth })).statusCode).toBe(204);
    expect((await h.app.inject({ method: "PUT", url: "/api/stations/favourites/BCT", headers: auth })).statusCode).toBe(204);
    let mine = (await h.app.inject({ method: "GET", url: "/api/stations/mine", headers: auth })).json();
    expect(mine.favourites.map((s: { code: string }) => s.code).sort()).toEqual(["BCT", "NDLS"]);

    expect((await h.app.inject({ method: "DELETE", url: "/api/stations/favourites/BCT", headers: auth })).statusCode).toBe(204);
    mine = (await h.app.inject({ method: "GET", url: "/api/stations/mine", headers: auth })).json();
    expect(mine.favourites.map((s: { code: string }) => s.code)).toEqual(["NDLS"]);

    expect((await h.app.inject({ method: "PUT", url: "/api/stations/favourites/ZZZZ", headers: auth })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PUT", url: "/api/stations/favourites/LKO", headers: auth })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PUT", url: "/api/stations/favourites/%3Cx%3E", headers: auth })).statusCode).toBe(404);
  });

  it("records recents when a journey is created", async () => {
    const p = (await h.app.inject({ method: "POST", url: "/api/passengers", headers: auth, payload: { name: "Raaisha", age: 8, gender: "FEMALE" } })).json();
    const res = await h.app.inject({
      method: "POST",
      url: "/api/journeys",
      headers: auth,
      payload: { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [p.id] },
    });
    expect(res.statusCode).toBe(201);
    const mine = (await h.app.inject({ method: "GET", url: "/api/stations/mine", headers: auth })).json();
    expect(mine.recents.map((s: { code: string }) => s.code).sort()).toEqual(["BCT", "NDLS"]);
  });
});
