import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseStationFile } from "../src/modules/stations/station-parsers.js";
import { createHarness, signIn, type Harness } from "./harness.js";

let h: Harness;
let A: { authorization: string };
let B: { authorization: string };
const pax: Record<string, string> = {};

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const call = (method: Method, url: string, headers: object, payload?: unknown) =>
  h.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload !== undefined && { payload: payload as object }) });

beforeAll(async () => {
  h = await createHarness();
  const fixture = parseStationFile(readFileSync(join(import.meta.dirname, "fixtures", "stations.test-only.csv"), "utf8"), "csv");
  await h.c.stations.importDataset(fixture, { version: "t1", source: "test fixture" }, { allowSmall: true });
  A = { authorization: `Bearer ${(await signIn(h, "9000000401")).accessToken}` };
  B = { authorization: `Bearer ${(await signIn(h, "9000000402")).accessToken}` };
  for (const [key, body] of Object.entries({
    meera: { name: "Meera Sancheti", age: 62, gender: "FEMALE", berthPreference: "LOWER", seniorCitizenOptIn: true },
    dev: { name: "Dev", age: 30, gender: "MALE", berthPreference: "UPPER" },
    asha: { name: "Asha", age: 28, gender: "FEMALE" },
  })) {
    pax[key] = (await call("POST", "/api/passengers", A, body)).json().id;
  }
  pax.bOwn = (await call("POST", "/api/passengers", B, { name: "Bina", age: 40, gender: "FEMALE" })).json().id;
});
afterAll(async () => {
  await h?.close();
});

const templateBody = () => ({
  name: "Diwali home trip",
  fromStationCode: "BCT",
  toStationCode: "NDLS",
  boardingStationCode: "ADI",
  quota: "TATKAL",
  passengers: [{ passengerId: pax.meera }, { passengerId: pax.dev, berthPreference: "SIDE_LOWER" }],
  trains: ["90102", "90101"],
  classes: ["3A", "2A"],
  considerAutoUpgradation: false,
  racWaitlistPreference: "ALLOW_RAC",
});

describe("authentication", () => {
  it("every Phase 4 endpoint requires a signed-in user", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const endpoints: Array<[Method, string]> = [
      ["GET", "/api/journey-options"],
      ["GET", "/api/trains/search?q=sample"],
      ["GET", "/api/trains/90101"],
      ["GET", "/api/journey-templates"],
      ["POST", "/api/journey-templates"],
      ["GET", `/api/journey-templates/${id}`],
      ["PATCH", `/api/journey-templates/${id}`],
      ["DELETE", `/api/journey-templates/${id}`],
      ["POST", `/api/journey-templates/${id}/journeys`],
      ["PUT", `/api/journey-templates/${id}/passengers`],
      ["POST", `/api/journey-templates/${id}/trains`],
      ["DELETE", `/api/journey-templates/${id}/classes/2A`],
      ["GET", `/api/journeys/${id}/readiness`],
      ["PATCH", `/api/journeys/${id}`],
      ["POST", `/api/journeys/${id}/duplicate`],
      ["PUT", `/api/journeys/${id}/trains`],
      ["POST", `/api/journeys/${id}/passengers`],
      ["DELETE", `/api/journeys/${id}/passengers/${id}`],
      ["PUT", `/api/journeys/${id}/classes`],
    ];
    for (const [method, url] of endpoints) {
      const res = await call(method, url, {}, method === "GET" || method === "DELETE" ? undefined : {});
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe("journey options and trains", () => {
  it("serves reference data and rule-driven limits, with their verification state", async () => {
    const o = (await call("GET", "/api/journey-options", A)).json();
    expect(o.defaultClassPriority).toEqual(["2A", "3A", "3E"]);
    expect(o.defaults).toMatchObject({ quota: "TATKAL", considerAutoUpgradation: true, racWaitlistPreference: "ALLOW_WAITLIST" });
    expect(o.classes.find((k: { code: string }) => k.code === "3A")).toMatchObject({ name: "AC 3 Tier", tatkalCategory: "AC" });
    expect(o.classes.find((k: { code: string }) => k.code === "SL").tatkalCategory).toBe("UNKNOWN"); // non-AC list not configured
    // Verified registry rules are served with their state; the name-length rule is not in the registry (MISSING, never invented).
    expect(o.rules.passengerLimit.TATKAL).toMatchObject({ ruleKey: "tatkal.max_passengers_per_pnr", value: 4, verificationStatus: "VERIFIED", isVerified: true });
    expect(o.rules.nameMaxLength).toMatchObject({ value: null, verificationStatus: "MISSING" });
    expect(o.rules.seniorConcessionOnTatkal).toMatchObject({ concession: "UNAVAILABLE", value: false, verificationStatus: "VERIFIED" });
    expect(o.trainData).toEqual({ provider: "mock", available: true });
  });

  it("searches the mock train provider and ranks trains on the route first", async () => {
    const res = (await call("GET", "/api/trains/search?q=sample&from=CSMT&to=PUNE", A)).json();
    expect(res).toMatchObject({ provider: "mock", available: true });
    expect(res.results[0].stops).toEqual(expect.arrayContaining(["CSMT", "PUNE"]));
    expect((await call("GET", "/api/trains/search?q=9010", A)).json().results.length).toBeGreaterThan(1);
    expect((await call("GET", "/api/trains/90101", A)).json()).toMatchObject({ number: "90101", name: "Sample Western Express" });
    expect((await call("GET", "/api/trains/99999", A)).statusCode).toBe(404);
    expect((await call("GET", "/api/trains/abc", A)).statusCode).toBe(404);
    expect((await call("GET", "/api/trains/search?q=", A)).statusCode).toBe(400);
  });
});

describe("journey templates", () => {
  let templateId: string;

  it("creates a template with explicit train and class priorities and per-passenger berths", async () => {
    const res = await call("POST", "/api/journey-templates", A, templateBody());
    expect(res.statusCode).toBe(201);
    const t = res.json();
    templateId = t.id;
    expect(t).toMatchObject({
      name: "Diwali home trip",
      fromStationName: "Mumbai Central",
      toStationName: "New Delhi",
      boardingStationCode: "ADI",
      boardingStationName: "Ahmedabad Junction",
      quota: "TATKAL",
      considerAutoUpgradation: false,
      racWaitlistPreference: "ALLOW_RAC",
      anyTrainAllowed: false,
    });
    expect(t.trains).toEqual([
      { priority: 1, trainNumber: "90102", trainName: "Sample Capital Superfast" },
      { priority: 2, trainNumber: "90101", trainName: "Sample Western Express" },
    ]);
    expect(t.classes).toEqual([{ priority: 1, classCode: "3A" }, { priority: 2, classCode: "2A" }]);
    // Berth: the passenger's saved preference unless overridden for this template.
    expect(t.passengers.map((p: { name: string; berthPreference: string }) => [p.name, p.berthPreference])).toEqual([
      ["Meera Sancheti", "LOWER"],
      ["Dev", "SIDE_LOWER"],
    ]);
    expect(t).not.toHaveProperty("userId");
  });

  it("applies defaults when optional preferences are left out", async () => {
    const t = (await call("POST", "/api/journey-templates", A, { name: "Weekend", fromStationCode: "CSMT", toStationCode: "PUNE" })).json();
    expect(t.classes.map((k: { classCode: string }) => k.classCode)).toEqual(["2A", "3A", "3E"]);
    expect(t).toMatchObject({ quota: "TATKAL", considerAutoUpgradation: true, racWaitlistPreference: "ALLOW_WAITLIST", passengers: [], trains: [] });
  });

  it("returns field-level validation errors", async () => {
    const same = await call("POST", "/api/journey-templates", A, { ...templateBody(), toStationCode: "BCT", boardingStationCode: null });
    expect(same.statusCode).toBe(400);
    expect(same.json().error.fields[0]).toMatchObject({ path: "toStationCode", message: "From and To must be different" });
    expect((await call("POST", "/api/journey-templates", A, { ...templateBody(), toStationCode: "ZZZ" })).json().error.code).toBe("UNKNOWN_STATION");
    expect((await call("POST", "/api/journey-templates", A, { ...templateBody(), trains: ["99999"] })).json().error).toMatchObject({
      code: "UNKNOWN_TRAIN",
      trainNumbers: ["99999"],
    });
    expect((await call("POST", "/api/journey-templates", A, { ...templateBody(), classes: ["ZZ"] })).statusCode).toBe(400);
    expect((await call("POST", "/api/journey-templates", A, { ...templateBody(), racWaitlistPreference: "ANY" })).statusCode).toBe(400);
    expect((await call("POST", "/api/journey-templates", A, { ...templateBody(), userId: "someone-else" })).statusCode).toBe(400);
    expect((await call("POST", "/api/journey-templates", A, { ...templateBody(), name: "" })).json().error.fields[0].path).toBe("name");
  });

  it("lists, reads and partially updates a template", async () => {
    const list = (await call("GET", "/api/journey-templates", A)).json();
    expect(list.map((t: { id: string }) => t.id)).toContain(templateId);
    const patched = (await call("PATCH", `/api/journey-templates/${templateId}`, A, { considerAutoUpgradation: true, quota: "PREMIUM_TATKAL" })).json();
    expect(patched).toMatchObject({ considerAutoUpgradation: true, quota: "PREMIUM_TATKAL", racWaitlistPreference: "ALLOW_RAC", name: "Diwali home trip" });
    expect(patched.trains).toHaveLength(2); // untouched lists stay
    // The merged route is re-validated.
    expect((await call("PATCH", `/api/journey-templates/${templateId}`, A, { toStationCode: "ADI" })).json().error.fields[0].path).toBe("boardingStationCode");
    expect((await call("GET", `/api/journey-templates/${templateId}`, A)).json().quota).toBe("PREMIUM_TATKAL");
  });

  it("creating a journey from a template copies it; later template edits don't change the journey", async () => {
    const res = await call("POST", `/api/journey-templates/${templateId}/journeys`, A, { journeyDate: "2026-10-30" });
    expect(res.statusCode).toBe(201);
    const { journey } = res.json();
    expect(journey).toMatchObject({ name: "Diwali home trip", templateId, journeyDate: "2026-10-30", state: "DRAFT", boardingStationCode: "ADI", considerAutoUpgradation: true });
    expect(journey.trains.map((t: { trainNumber: string }) => t.trainNumber)).toEqual(["90102", "90101"]);
    expect(journey.passengers.map((p: { berthPreference: string }) => p.berthPreference)).toEqual(["LOWER", "SIDE_LOWER"]);

    await call("PUT", `/api/journey-templates/${templateId}/classes`, A, { classes: ["1A"] });
    await call("PATCH", `/api/journey-templates/${templateId}`, A, { name: "Renamed", racWaitlistPreference: "CONFIRMED_ONLY" });
    await call("DELETE", `/api/journey-templates/${templateId}/passengers/${pax.dev}`, A);

    const after = (await call("GET", `/api/journeys/${journey.id}`, A)).json();
    expect(after.name).toBe("Diwali home trip");
    expect(after.racWaitlistPreference).toBe("ALLOW_RAC");
    expect(after.classes.map((k: { classCode: string }) => k.classCode)).toEqual(["3A", "2A"]);
    expect(after.passengers).toHaveLength(2);

    // Deleting the template leaves the journey intact.
    expect((await call("DELETE", `/api/journey-templates/${templateId}`, A)).statusCode).toBe(204);
    expect((await call("GET", `/api/journey-templates/${templateId}`, A)).statusCode).toBe(404);
    expect((await call("GET", `/api/journeys/${journey.id}`, A)).statusCode).toBe(200);
  });

  it("rejects a past date when creating from a template", async () => {
    const t = (await call("POST", "/api/journey-templates", A, templateBody())).json();
    expect((await call("POST", `/api/journey-templates/${t.id}/journeys`, A, { journeyDate: "2026-09-24" })).statusCode).toBe(400);
  });
});

describe("journeys", () => {
  let id: string;

  it("creates a journey directly with every preference, and stores a rule snapshot", async () => {
    const res = await call("POST", "/api/journeys", A, {
      name: "Office trip",
      fromStationCode: "CSMT",
      toStationCode: "PUNE",
      journeyDate: "2026-10-20",
      passengers: [{ passengerId: pax.asha }, { passengerId: pax.dev }],
      trains: ["90104", "90103"],
      classes: ["CC", "EC"],
      anyTrainAllowed: false,
      useNextAvailableClass: false,
      considerAutoUpgradation: false,
      racWaitlistPreference: "CONFIRMED_ONLY",
    });
    expect(res.statusCode).toBe(201);
    const { journey, warnings } = res.json();
    id = journey.id;
    expect(journey).toMatchObject({ name: "Office trip", state: "DRAFT", templateId: null, useNextAvailableClass: false, considerAutoUpgradation: false, racWaitlistPreference: "CONFIRMED_ONLY" });
    expect(journey.passengers.map((p: { berthPreference: string }) => p.berthPreference)).toEqual(["NO_PREFERENCE", "UPPER"]);
    expect(journey.trains).toEqual([
      { priority: 1, trainNumber: "90104", trainName: "Sample Deccan Link" },
      { priority: 2, trainNumber: "90103", trainName: "Sample Northern Mail" },
    ]);
    expect(journey.ruleSnapshot).toMatchObject({ version: 1, capturedAt: "2026-09-25T04:30:00.000Z" });
    expect(journey.ruleSnapshot.rules["tatkal.ac.opening_time"]).toMatchObject({ value: "10:00", verificationStatus: "UNVERIFIED", isVerified: false });
    expect(journey.ruleSnapshot.rules["tatkal.max_passengers_per_pnr"]).toMatchObject({ value: 4, verificationStatus: "VERIFIED", isVerified: true });
    expect(journey.ruleSnapshot.rules["passenger.name_max_length"]).toBeNull(); // recorded as missing
    expect(journey.readiness.overall).not.toBe("READY");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("gives Phase 3 style journeys a readable name and the default class priority", async () => {
    const { journey } = (await call("POST", "/api/journeys", A, { fromStationCode: "BCT", toStationCode: "MAO", journeyDate: "2026-11-02", passengerIds: [pax.asha] })).json();
    expect(journey.name).toBe("Mumbai Central to Madgaon");
    expect(journey.classes.map((k: { classCode: string }) => k.classCode)).toEqual(["2A", "3A", "3E"]);
  });

  it("edits scalar preferences and whole lists in one request", async () => {
    const res = await call("PATCH", `/api/journeys/${id}`, A, {
      journeyDate: "2026-10-21",
      considerAutoUpgradation: true,
      racWaitlistPreference: "ALLOW_WAITLIST",
      classes: ["EC", "CC", "2S"],
      passengers: [{ passengerId: pax.dev, berthPreference: "LOWER" }],
    });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j).toMatchObject({ journeyDate: "2026-10-21", considerAutoUpgradation: true, racWaitlistPreference: "ALLOW_WAITLIST", useNextAvailableClass: false });
    expect(j.classes).toEqual([
      { priority: 1, classCode: "EC" },
      { priority: 2, classCode: "CC" },
      { priority: 3, classCode: "2S" },
    ]);
    expect(j.passengers).toEqual([expect.objectContaining({ id: pax.dev, berthPreference: "LOWER" })]);
    expect(j.trains).toHaveLength(2); // untouched
    // The creation snapshot is kept as history.
    expect(j.ruleSnapshot.capturedAt).toBe("2026-09-25T04:30:00.000Z");
  });

  it("rejects invalid edits", async () => {
    expect((await call("PATCH", `/api/journeys/${id}`, A, { journeyDate: "2026-09-01" })).statusCode).toBe(400);
    expect((await call("PATCH", `/api/journeys/${id}`, A, { toStationCode: "CSMT" })).json().error.fields[0].path).toBe("toStationCode");
    expect((await call("PATCH", `/api/journeys/${id}`, A, { classes: [] })).statusCode).toBe(400);
    expect((await call("PATCH", `/api/journeys/${id}`, A, { state: "CONFIRMED" })).statusCode).toBe(400);
  });

  it("only drafts can be edited", async () => {
    const { journey } = (await call("POST", "/api/journeys", A, { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-11-05", passengerIds: [pax.asha] })).json();
    await h.db.journey.update({ where: { id: journey.id }, data: { state: "SCHEDULED" } });
    expect((await call("PATCH", `/api/journeys/${journey.id}`, A, { name: "x" })).json().error.code).toBe("JOURNEY_NOT_EDITABLE");
    expect((await call("POST", `/api/journeys/${journey.id}/classes`, A, { classCode: "1A" })).json().error.code).toBe("JOURNEY_NOT_EDITABLE");
  });

  it("duplicates a journey with a fresh rule snapshot", async () => {
    h.clock.advance(60_000);
    const res = await call("POST", `/api/journeys/${id}/duplicate`, A, { journeyDate: "2026-12-01" });
    expect(res.statusCode).toBe(201);
    const copy = res.json().journey;
    expect(copy.id).not.toBe(id);
    expect(copy).toMatchObject({ name: "Copy of Office trip", journeyDate: "2026-12-01", state: "DRAFT", racWaitlistPreference: "ALLOW_WAITLIST", considerAutoUpgradation: true });
    expect(copy.classes.map((k: { classCode: string }) => k.classCode)).toEqual(["EC", "CC", "2S"]);
    expect(copy.trains.map((t: { trainNumber: string }) => t.trainNumber)).toEqual(["90104", "90103"]);
    expect(copy.passengers).toEqual([expect.objectContaining({ id: pax.dev, berthPreference: "LOWER" })]);
    expect(copy.ruleSnapshot.capturedAt).toBe("2026-09-25T04:31:00.000Z");
    // Duplicating without a date keeps the original date (still in the future).
    expect((await call("POST", `/api/journeys/${id}/duplicate`, A, {})).json().journey.journeyDate).toBe("2026-10-21");
  });

  it("asks for a new date when duplicating a journey whose date has passed, and leaves out removed passengers", async () => {
    const tmp = (await call("POST", "/api/passengers", A, { name: "Temp", age: 20, gender: "MALE" })).json();
    const { journey } = (await call("POST", "/api/journeys", A, { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-09-26", passengerIds: [pax.asha, tmp.id] })).json();
    await call("DELETE", `/api/passengers/${tmp.id}`, A);
    expect((await call("GET", `/api/journeys/${journey.id}`, A)).json().passengers.find((p: { id: string }) => p.id === tmp.id).removed).toBe(true);

    // Backdate it (the API never accepts past dates). Moving the clock would expire the access token.
    await h.db.journey.update({ where: { id: journey.id }, data: { journeyDate: new Date("2026-09-20T00:00:00.000Z") } });
    const noDate = await call("POST", `/api/journeys/${journey.id}/duplicate`, A, {});
    expect(noDate.json().error.fields[0].message).toMatch(/original date has passed/);
    const res = (await call("POST", `/api/journeys/${journey.id}/duplicate`, A, { journeyDate: "2026-10-10", name: "Again" })).json();
    expect(res.journey.name).toBe("Again");
    expect(res.journey.passengers.map((p: { id: string }) => p.id)).toEqual([pax.asha]);
    expect(res.warnings[0]).toMatch(/1 passenger was left out/);
  });

  it("lists journeys with a readiness status and deletes them", async () => {
    const list = (await call("GET", "/api/journeys", A)).json();
    expect(list.length).toBeGreaterThan(2);
    for (const j of list) expect(["READY", "WARNING", "NOT_READY"]).toContain(j.readinessStatus);
    expect((await call("DELETE", `/api/journeys/${id}`, A)).statusCode).toBe(204);
    expect((await call("GET", `/api/journeys/${id}`, A)).statusCode).toBe(404);
    expect((await call("GET", `/api/journeys/${id}/readiness`, A)).statusCode).toBe(404);
  });
});

describe("passenger, train and class lists", () => {
  let j: string;
  const base = () => `/api/journeys/${j}`;
  beforeAll(async () => {
    j = (await call("POST", "/api/journeys", A, { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [pax.asha] })).json().journey.id;
  });

  it("adds, reorders and removes preferred trains, keeping priorities 1..n", async () => {
    expect((await call("POST", `${base()}/trains`, A, { trainNumber: "90101" })).statusCode).toBe(201);
    await call("POST", `${base()}/trains`, A, { trainNumber: "90102" });
    let r = (await call("POST", `${base()}/trains`, A, { trainNumber: "90108" })).json();
    expect(r.trains.map((t: { priority: number; trainNumber: string }) => [t.priority, t.trainNumber])).toEqual([
      [1, "90101"],
      [2, "90102"],
      [3, "90108"],
    ]);
    expect((await call("POST", `${base()}/trains`, A, { trainNumber: "90101" })).json().error.code).toBe("ALREADY_ADDED");
    expect((await call("POST", `${base()}/trains`, A, { trainNumber: "99999" })).json().error.code).toBe("UNKNOWN_TRAIN");

    r = (await call("PUT", `${base()}/trains`, A, { trains: ["90108", "90101", "90102"] })).json();
    expect(r.trains.map((t: { trainNumber: string }) => t.trainNumber)).toEqual(["90108", "90101", "90102"]);

    r = (await call("DELETE", `${base()}/trains/90101`, A)).json();
    expect(r.trains.map((t: { priority: number; trainNumber: string }) => [t.priority, t.trainNumber])).toEqual([
      [1, "90108"],
      [2, "90102"],
    ]);
    expect((await call("DELETE", `${base()}/trains/90101`, A)).statusCode).toBe(404);
    // The readiness preview flags a train that doesn't run on the route.
    expect(r.readiness.items.find((i: { key: string }) => i.key === "trains")).toMatchObject({ status: "WARN" });
  });

  it("caps the number of preferred trains", async () => {
    await call("PUT", `${base()}/trains`, A, { trains: ["90101", "90102", "90103", "90104", "90105"] });
    expect((await call("POST", `${base()}/trains`, A, { trainNumber: "90106" })).json().error.code).toBe("TOO_MANY_TRAINS");
    expect((await call("PUT", `${base()}/trains`, A, { trains: ["90101", "90102", "90103", "90104", "90105", "90106"] })).statusCode).toBe(400);
  });

  it("reorders classes and keeps at least one", async () => {
    let r = (await call("PUT", `${base()}/classes`, A, { classes: ["3E", "3A"] })).json();
    expect(r.classes).toEqual([{ priority: 1, classCode: "3E" }, { priority: 2, classCode: "3A" }]);
    r = (await call("POST", `${base()}/classes`, A, { classCode: "SL" })).json();
    expect(r.classes.map((k: { classCode: string }) => k.classCode)).toEqual(["3E", "3A", "SL"]);
    await call("DELETE", `${base()}/classes/3E`, A);
    r = (await call("DELETE", `${base()}/classes/SL`, A)).json();
    expect(r.classes).toEqual([{ priority: 1, classCode: "3A" }]);
    expect((await call("DELETE", `${base()}/classes/3A`, A)).json().error.code).toBe("LAST_CLASS");
    expect((await call("POST", `${base()}/classes`, A, { classCode: "3A" })).json().error.code).toBe("ALREADY_ADDED");
  });

  it("adds and removes passengers, with a berth for this journey", async () => {
    let r = (await call("POST", `${base()}/passengers`, A, { passengerId: pax.meera, berthPreference: "MIDDLE" })).json();
    expect(r.passengers.map((p: { id: string; berthPreference: string }) => [p.id, p.berthPreference])).toEqual([
      [pax.asha, "NO_PREFERENCE"],
      [pax.meera, "MIDDLE"],
    ]);
    expect((await call("POST", `${base()}/passengers`, A, { passengerId: pax.meera })).json().error.code).toBe("ALREADY_ADDED");
    r = (await call("DELETE", `${base()}/passengers/${pax.asha}`, A)).json();
    expect(r.passengers.map((p: { id: string }) => p.id)).toEqual([pax.meera]);
    r = (await call("PUT", `${base()}/passengers`, A, { passengers: [{ passengerId: pax.dev }, { passengerId: pax.meera }] })).json();
    expect(r.passengers.map((p: { id: string }) => p.id)).toEqual([pax.dev, pax.meera]);
    expect((await call("PUT", `${base()}/passengers`, A, { passengers: [{ passengerId: pax.dev }, { passengerId: pax.dev }] })).statusCode).toBe(400);
  });

  it("the same list routes work on templates", async () => {
    const t = (await call("POST", "/api/journey-templates", A, { name: "Lists", fromStationCode: "BCT", toStationCode: "NDLS" })).json();
    await call("POST", `/api/journey-templates/${t.id}/trains`, A, { trainNumber: "90102" });
    await call("POST", `/api/journey-templates/${t.id}/trains`, A, { trainNumber: "90101" });
    const r = (await call("PUT", `/api/journey-templates/${t.id}/trains`, A, { trains: ["90101", "90102"] })).json();
    expect(r.trains.map((x: { priority: number; trainNumber: string }) => [x.priority, x.trainNumber])).toEqual([
      [1, "90101"],
      [2, "90102"],
    ]);
    expect((await call("POST", `/api/journey-templates/${t.id}/passengers`, A, { passengerId: pax.dev })).json().passengers).toHaveLength(1);
  });
});

describe("ownership", () => {
  let aJourney: string;
  let aTemplate: string;
  beforeAll(async () => {
    aJourney = (await call("POST", "/api/journeys", A, { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [pax.asha] })).json().journey.id;
    aTemplate = (await call("POST", "/api/journey-templates", A, templateBody())).json().id;
  });

  it("another user's journey is indistinguishable from a missing one", async () => {
    const attempts: Array<[Method, string, unknown?]> = [
      ["GET", `/api/journeys/${aJourney}`],
      ["GET", `/api/journeys/${aJourney}/readiness`],
      ["PATCH", `/api/journeys/${aJourney}`, { name: "mine now" }],
      ["POST", `/api/journeys/${aJourney}/duplicate`, {}],
      ["DELETE", `/api/journeys/${aJourney}`],
      ["PUT", `/api/journeys/${aJourney}/trains`, { trains: ["90101"] }],
      ["POST", `/api/journeys/${aJourney}/classes`, { classCode: "1A" }],
      ["DELETE", `/api/journeys/${aJourney}/passengers/${pax.asha}`],
    ];
    for (const [method, url, body] of attempts) {
      expect((await call(method, url, B, body)).statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await call("GET", "/api/journeys", B)).json().map((j: { id: string }) => j.id)).not.toContain(aJourney);
    // A's journey is unchanged.
    const mine = (await call("GET", `/api/journeys/${aJourney}`, A)).json();
    expect(mine.passengers).toHaveLength(1);
    expect(mine.name).not.toBe("mine now");
  });

  it("another user's template can't be read, changed or used", async () => {
    for (const [method, url, body] of [
      ["GET", `/api/journey-templates/${aTemplate}`],
      ["PATCH", `/api/journey-templates/${aTemplate}`, { name: "x" }],
      ["DELETE", `/api/journey-templates/${aTemplate}`],
      ["POST", `/api/journey-templates/${aTemplate}/journeys`, { journeyDate: "2026-10-25" }],
      ["PUT", `/api/journey-templates/${aTemplate}/classes`, { classes: ["1A"] }],
    ] as Array<[Method, string, unknown?]>) {
      expect((await call(method, url, B, body)).statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await call("GET", "/api/journey-templates", B)).json()).toEqual([]);
  });

  it("can't attach another user's passenger to your own journey or template", async () => {
    const mine = (await call("POST", "/api/journeys", B, { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [pax.bOwn] })).json().journey.id;
    expect((await call("POST", `/api/journeys/${mine}/passengers`, B, { passengerId: pax.meera })).statusCode).toBe(404);
    expect((await call("PUT", `/api/journeys/${mine}/passengers`, B, { passengers: [{ passengerId: pax.meera }] })).statusCode).toBe(404);
    expect((await call("POST", "/api/journeys", B, { fromStationCode: "BCT", toStationCode: "NDLS", journeyDate: "2026-10-25", passengerIds: [pax.meera] })).statusCode).toBe(404);
    expect((await call("POST", "/api/journey-templates", B, { ...templateBody(), passengers: [{ passengerId: pax.meera }] })).statusCode).toBe(404);
  });

  it("malformed IDs look like unknown ones", async () => {
    expect((await call("GET", "/api/journeys/not-a-uuid", A)).statusCode).toBe(404);
    expect((await call("DELETE", `/api/journeys/${aJourney}/passengers/not-a-uuid`, A)).statusCode).toBe(404);
    expect((await call("DELETE", `/api/journeys/${aJourney}/classes/ZZ`, A)).statusCode).toBe(404);
  });
});

describe("audit trail", () => {
  it("records journey and template changes with IDs and field names only", async () => {
    const logs = await h.db.auditLog.findMany({ where: { OR: [{ action: { startsWith: "journey" } }] } });
    const actions = new Set(logs.map((l) => l.action));
    for (const a of ["journey.created", "journey.updated", "journey.duplicated", "journey.deleted", "journey_template.created", "journey_template.updated", "journey_template.deleted"]) {
      expect(actions, a).toContain(a);
    }
    const blob = JSON.stringify(logs.map((l) => l.metadata));
    expect(blob).not.toMatch(/Meera|Dev"|Asha|Sample|Diwali|Office trip/);
    expect(logs.find((l) => l.action === "journey.updated" && JSON.stringify(l.metadata).includes("racWaitlistPreference"))?.metadata).toMatchObject({
      fields: expect.arrayContaining(["racWaitlistPreference", "classes"]),
    });
  });
});
