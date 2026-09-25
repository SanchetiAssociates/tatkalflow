import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JourneyDetailDto, JourneyOptionsDto, PassengerDto } from "@tatkalflow/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, validateStep } from "../features/journeys/editor/draft";
import { fakeSession, renderRoutes } from "./harness";

const mocks = vi.hoisted(() => ({ session: null as unknown as ReturnType<typeof import("./harness").fakeSession>, api: vi.fn() }));
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    get session() {
      return mocks.session;
    },
    api: (...args: unknown[]) => mocks.api(...args),
  };
});
const { ApiError } = await vi.importActual<typeof import("../lib/api")>("../lib/api");

// ── Fixtures ───────────────────────────────────────────────────────────────

const FUTURE = "2027-01-15";
const passenger = (id: string, name: string, extra: Partial<PassengerDto> = {}): PassengerDto => ({
  id,
  name,
  age: 30,
  gender: "FEMALE",
  berthPreference: "NO_PREFERENCE",
  foodPreference: "NO_PREFERENCE",
  seniorCitizenOptIn: false,
  childBerthOptIn: true,
  lastUsedAt: null,
  createdAt: "",
  updatedAt: "",
  ...extra,
});
const PASSENGERS = [
  passenger("p-meera", "Meera", { age: 62, berthPreference: "LOWER", seniorCitizenOptIn: true }),
  passenger("p-dev", "Dev", { gender: "MALE", berthPreference: "UPPER" }),
  passenger("p-sid", "Siddharth Sancheti", { gender: "MALE", age: 39 }),
];

const rule = (ruleKey: string, value: unknown, isVerified = false) => ({
  ruleKey,
  label: ruleKey,
  value,
  verificationStatus: value === null ? ("MISSING" as const) : isVerified ? ("VERIFIED" as const) : ("UNVERIFIED" as const),
  isVerified,
});
function options(limit: number | null = 4): JourneyOptionsDto {
  return {
    classes: [
      { code: "1A", name: "AC First Class", tatkalCategory: "UNKNOWN" },
      { code: "2A", name: "AC 2 Tier", tatkalCategory: "AC" },
      { code: "3A", name: "AC 3 Tier", tatkalCategory: "AC" },
      { code: "3E", name: "AC 3 Economy", tatkalCategory: "AC" },
      { code: "SL", name: "Sleeper", tatkalCategory: "UNKNOWN" },
    ],
    defaultClassPriority: ["2A", "3A", "3E"],
    quotas: [
      { value: "TATKAL", label: "Tatkal" },
      { value: "PREMIUM_TATKAL", label: "Premium Tatkal" },
      { value: "GENERAL", label: "General" },
    ],
    racWaitlistPreferences: [
      { value: "CONFIRMED_ONLY", label: "Confirmed berths only", description: "Only confirmed." },
      { value: "ALLOW_RAC", label: "Confirmed or RAC", description: "RAC too." },
      { value: "ALLOW_WAITLIST", label: "Confirmed, RAC or waitlist", description: "Waitlist too." },
    ],
    defaults: { quota: "TATKAL", anyTrainAllowed: false, useNextAvailableClass: true, considerAutoUpgradation: true, racWaitlistPreference: "ALLOW_WAITLIST" },
    maxPreferredTrains: 5,
    rules: {
      passengerLimit: { TATKAL: rule("tatkal.max_passengers_per_pnr", limit), PREMIUM_TATKAL: rule("tatkal.max_passengers_per_pnr", limit), GENERAL: rule("general.max_passengers_per_pnr", null) },
      nameMaxLength: rule("passenger.name_max_length", 16),
      seniorConcessionOnTatkal: { ...rule("tatkal.senior_citizen_concession_available", null), concession: "UNAVAILABLE" },
    },
    trainData: { provider: "mock", available: true },
  };
}

const TRAINS = [
  { number: "90101", name: "Sample Western Express", fromStationCode: "BCT", toStationCode: "NDLS", stops: ["BCT", "NDLS"], classes: [] },
  { number: "90102", name: "Sample Capital Superfast", fromStationCode: "BCT", toStationCode: "NDLS", stops: ["BCT", "NDLS"], classes: [] },
];

function detail(over: Partial<JourneyDetailDto> = {}): JourneyDetailDto {
  return {
    id: "j1",
    name: "Diwali trip",
    fromStationCode: "BCT",
    fromStationName: "Mumbai Central",
    toStationCode: "NDLS",
    toStationName: "New Delhi",
    boardingStationCode: null,
    boardingStationName: null,
    quota: "TATKAL",
    passengers: [{ id: "p-dev", name: "Dev", age: 30, gender: "MALE", berthPreference: "UPPER", seniorCitizenOptIn: false, removed: false }],
    trains: [
      { priority: 1, trainNumber: "90102", trainName: "Sample Capital Superfast" },
      { priority: 2, trainNumber: "90101", trainName: "Sample Western Express" },
    ],
    classes: [
      { priority: 1, classCode: "3A" },
      { priority: 2, classCode: "2A" },
    ],
    anyTrainAllowed: false,
    useNextAvailableClass: true,
    considerAutoUpgradation: false,
    racWaitlistPreference: "CONFIRMED_ONLY",
    createdAt: "",
    updatedAt: "",
    journeyDate: FUTURE,
    state: "DRAFT",
    templateId: null,
    readinessStatus: "NOT_READY",
    readiness: {
      overall: "NOT_READY",
      items: [
        { key: "route", status: "PASS", label: "Route" },
        { key: "irctc_account", status: "FAIL", label: "IRCTC user ID", detail: "Add your IRCTC user ID in Profile." },
        { key: "rules_verified", status: "WARN", label: "Railway rules", detail: "These rules have not been verified against an official source yet." },
      ],
    },
    ruleSnapshot: { version: 1, capturedAt: "2026-09-25T04:30:00.000Z", rules: { "tatkal.max_passengers_per_pnr": null } },
    ...over,
  };
}

/** A tiny fake backend. Unknown requests fail loudly. */
function backend(opts: { limit?: number | null; journeys?: Record<string, JourneyDetailDto>; onWrite?: (path: string, init: { method?: string; body?: unknown }) => unknown } = {}) {
  const journeys = opts.journeys ?? { j1: detail() };
  mocks.api.mockImplementation(async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const method = init.method ?? "GET";
    if (method !== "GET") return opts.onWrite?.(path, init);
    if (path === "/api/me") return { id: "u1", mobile: "+919820012345", fullName: null, email: null, notificationPreferences: { push: true, email: false, sms: false } };
    if (path === "/api/journey-options") return options(opts.limit === undefined ? 4 : opts.limit);
    if (path === "/api/passengers") return PASSENGERS;
    if (path === "/api/journeys") return Object.values(journeys);
    if (path === "/api/journey-templates") return [];
    if (path === "/api/stations/mine")
      return {
        favourites: [
          { code: "BCT", name: "Mumbai Central", state: "Maharashtra" },
          { code: "NDLS", name: "New Delhi", state: "Delhi" },
        ],
        recents: [],
      };
    if (path.startsWith("/api/trains/search")) return { provider: "mock", available: true, results: TRAINS };
    const j = /^\/api\/journeys\/([\w-]+)$/.exec(path);
    if (j && journeys[j[1]!]) return journeys[j[1]!];
    if (path === "/api/journey-templates/t1") return { ...detail(), id: "t1", name: "Home trip" };
    throw new Error(`unexpected ${method} ${path}`);
  });
}
const writes = () => mocks.api.mock.calls.filter(([, init]) => init && (init as { method?: string }).method && (init as { method: string }).method !== "GET");

async function pickStation(label: "From" | "To", name: string) {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
}
const next = () => userEvent.click(screen.getByRole("button", { name: /Next/ }));
const listOrder = (label: string) => within(screen.getByRole("list", { name: label })).getAllByRole("listitem").map((li) => li.textContent);

beforeEach(() => {
  mocks.api.mockReset();
  mocks.session = fakeSession({ status: "authenticated", user: { id: "u1", mobile: "+919820012345", fullName: "Test" } });
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("journey creation flow", () => {
  it("walks through the steps and saves ordered trains, classes, passengers and preferences", async () => {
    backend({ onWrite: (path) => (path === "/api/journeys" ? { journey: detail(), warnings: [] } : undefined) });
    await renderRoutes("/trips/new");

    // Step 1: route. Required fields are checked before moving on.
    expect(await screen.findByRole("heading", { name: "Route" })).toBeInTheDocument();
    await next();
    expect(screen.getByText("Choose where you're travelling from")).toBeInTheDocument();
    expect(screen.getByText("Choose a travel date")).toBeInTheDocument();
    await pickStation("From", "Mumbai Central");
    await pickStation("To", "New Delhi");
    fireEvent.change(screen.getByLabelText("Journey date"), { target: { value: FUTURE } });
    await userEvent.type(screen.getByLabelText("Journey name (optional)"), "Diwali trip");
    await next();

    // Step 2: preferred trains with explicit priority.
    expect(await screen.findByRole("heading", { name: "Trains" })).toHaveFocus();
    await userEvent.type(screen.getByLabelText("Find a train"), "sample");
    await userEvent.click(await screen.findByRole("button", { name: /Add 90101/ }));
    await userEvent.click(screen.getByRole("button", { name: /Add 90102/ }));
    expect(listOrder("Preferred trains").map((t) => t?.slice(0, 6))).toEqual(["190101", "290102"]);
    await userEvent.click(screen.getByRole("button", { name: "Move 90102 up" }));
    expect(listOrder("Preferred trains").map((t) => t?.slice(0, 6))).toEqual(["190102", "290101"]);
    expect(screen.getByText("90102 moved to priority 1")).toBeInTheDocument();
    expect(screen.getByText(/sample data in this development build/)).toBeInTheDocument();
    await next();

    // Step 3: class priority defaults to 2A → 3A → 3E and can be reordered.
    expect(listOrder("Class preference").map((t) => t?.slice(0, 3))).toEqual(["12A", "23A", "33E"]);
    await userEvent.click(screen.getByRole("button", { name: "Move 3A up" }));
    expect(listOrder("Class preference").map((t) => t?.slice(0, 3))).toEqual(["13A", "22A", "33E"]);
    await next();

    // Step 4: passengers, with rule-driven limits and warnings.
    expect(screen.getByText(/Up to 4 passengers per booking\. This rule hasn't been verified/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Meera/ }));
    expect(screen.getByText(/Senior-citizen concession isn't available on Tatkal bookings/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Siddharth Sancheti/ }));
    expect(screen.getByText(/Name is longer than 16 characters/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getAllByLabelText("Berth for this journey")[0]!, "SIDE_LOWER");
    await next();

    // Step 5: RAC / waitlist and auto-upgrade.
    await userEvent.click(screen.getByRole("radio", { name: /Confirmed berths only/ }));
    await userEvent.click(screen.getByRole("switch", { name: "Consider for auto-upgradation" }));
    await next();

    // Step 6: review, then save.
    expect(screen.getByRole("list", { name: "Preferred trains in priority order" })).toHaveTextContent(/1\.90102.*2\.90101/);
    await userEvent.click(screen.getByRole("button", { name: "Save journey" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, init] = writes()[0]! as [string, { method: string; body: Record<string, unknown> }];
    expect(path).toBe("/api/journeys");
    expect(init.body).toMatchObject({
      name: "Diwali trip",
      fromStationCode: "BCT",
      toStationCode: "NDLS",
      journeyDate: FUTURE,
      quota: "TATKAL",
      trains: ["90102", "90101"],
      classes: ["3A", "2A", "3E"],
      passengers: [
        { passengerId: "p-meera", berthPreference: "SIDE_LOWER" },
        { passengerId: "p-sid", berthPreference: "NO_PREFERENCE" },
      ],
      racWaitlistPreference: "CONFIRMED_ONLY",
      considerAutoUpgradation: false,
    });
    // Lands on the new journey's summary.
    expect(await screen.findByText("Journey saved.")).toBeInTheDocument();
  });

  it("never offers a senior-citizen concession control", async () => {
    backend();
    await renderRoutes("/trips/new");
    await screen.findByRole("heading", { name: "Route" });
    expect(screen.queryByRole("switch", { name: /concession/i })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /concession/i })).toBeNull();
  });

  it("blocks more passengers than the configured limit", async () => {
    backend({ limit: 1 });
    await renderRoutes(`/trips/j1/edit`);
    await screen.findByRole("heading", { name: "Route" });
    for (let i = 0; i < 3; i++) await next();
    await userEvent.click(screen.getByRole("checkbox", { name: /Meera/ }));
    await next();
    expect(screen.getByRole("alert")).toHaveTextContent("At most 1 passenger per booking");
    expect(screen.getByRole("heading", { name: "Passengers" })).toBeInTheDocument();
  });

  it("sends the user back to the right step when the server rejects a field", async () => {
    backend({
      onWrite: () => {
        throw new ApiError(400, "VALIDATION_ERROR", "Some details need attention.", [{ path: "journeyDate", message: "Journey date is in the past" }]);
      },
    });
    await renderRoutes(`/trips/j1/edit`);
    await screen.findByRole("heading", { name: "Route" });
    for (let i = 0; i < 5; i++) await next();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("heading", { name: "Route" })).toBeInTheDocument();
    expect(screen.getAllByText("Journey date is in the past").length).toBeGreaterThan(0);
  });
});

describe("editing", () => {
  it("prefills the editor and saves changes with PATCH", async () => {
    backend({ onWrite: () => detail({ racWaitlistPreference: "ALLOW_RAC" }) });
    await renderRoutes("/trips/j1/edit");
    expect(await screen.findByLabelText("Journey name (optional)")).toHaveValue("Diwali trip");
    await next();
    expect(listOrder("Preferred trains").map((t) => t?.slice(0, 6))).toEqual(["190102", "290101"]);
    await userEvent.click(screen.getByRole("button", { name: "Remove 90101" }));
    await next();
    expect(listOrder("Class preference").map((t) => t?.slice(0, 3))).toEqual(["13A", "22A"]);
    await userEvent.click(screen.getByRole("button", { name: /Add SL/ }));
    await next();
    expect(screen.getByRole("checkbox", { name: /Dev/ })).toBeChecked();
    await next();
    await userEvent.click(screen.getByRole("radio", { name: /Confirmed or RAC/ }));
    await next();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, init] = writes()[0]! as [string, { method: string; body: Record<string, unknown> }];
    expect([path, init.method]).toEqual(["/api/journeys/j1", "PATCH"]);
    expect(init.body).toMatchObject({ trains: ["90102"], classes: ["3A", "2A", "SL"], racWaitlistPreference: "ALLOW_RAC", passengers: [{ passengerId: "p-dev", berthPreference: "UPPER" }] });
  });
});

describe("journey summary and readiness", () => {
  it("shows the readiness checklist with text, not colour alone", async () => {
    backend();
    await renderRoutes("/trips/j1");
    expect(await screen.findByTestId("readiness-overall")).toHaveTextContent("Not ready");
    const irctc = screen.getByText("IRCTC user ID").closest("li")!;
    expect(irctc).toHaveAttribute("data-status", "FAIL");
    expect(irctc).toHaveTextContent("Missing");
    expect(screen.getByText(/not been verified against an official source/)).toBeInTheDocument();
    expect(screen.getByText(/TatkalFlow doesn't book tickets/)).toBeInTheDocument();
    // Summary: priorities, preferences and the rule snapshot.
    expect(screen.getByRole("list", { name: "Preferred trains in priority order" })).toHaveTextContent(/1\.90102.*2\.90101/);
    expect(screen.getByRole("list", { name: "Classes in priority order" })).toHaveTextContent(/1\.3A.*2\.2A/);
    expect(screen.getByText("Confirmed berths only")).toBeInTheDocument();
    expect(screen.getByText("Auto-upgradation").nextSibling).toHaveTextContent("No");
    expect(screen.getByText(/Railway rules when this journey was created/)).toBeInTheDocument();
  });

  it("shows READY only when the server says so", async () => {
    backend({ journeys: { j1: detail({ readinessStatus: "READY", readiness: { overall: "READY", items: [{ key: "route", status: "PASS", label: "Route" }] } }) } });
    await renderRoutes("/trips/j1");
    expect(await screen.findByTestId("readiness-overall")).toHaveTextContent("Ready");
  });

  it("lists journeys with their readiness status", async () => {
    backend({ journeys: { j1: detail(), j2: detail({ id: "j2", name: "Weekend", readinessStatus: "WARNING" }) } });
    await renderRoutes("/trips");
    expect(await screen.findByRole("link", { name: /Diwali trip/ })).toHaveAttribute("href", "/trips/j1");
    expect(screen.getByText("Not ready")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });
});

describe("duplicate and delete", () => {
  it("duplicates with a chosen date and opens the copy", async () => {
    backend({
      journeys: { j1: detail(), j2: detail({ id: "j2", name: "Copy of Diwali trip" }) },
      onWrite: (path) => (path === "/api/journeys/j1/duplicate" ? { journey: detail({ id: "j2", name: "Copy of Diwali trip" }), warnings: [] } : undefined),
    });
    await renderRoutes("/trips/j1");
    await userEvent.click(await screen.findByRole("button", { name: /Duplicate/ }));
    const date = screen.getByLabelText("Journey date", { selector: "#dialog-journey-date" });
    expect(date).toHaveValue(FUTURE);
    fireEvent.change(date, { target: { value: "2027-02-01" } });
    await userEvent.click(within(date.closest("dialog")!).getByRole("button", { name: "Duplicate", hidden: true }));
    await waitFor(() => expect(writes()[0]).toEqual(["/api/journeys/j1/duplicate", { method: "POST", body: { journeyDate: "2027-02-01" } }]));
    expect(await screen.findByRole("heading", { name: "Copy of Diwali trip" })).toBeInTheDocument();
    // Regression: the dialog must not stay open on the copy's page.
    expect(document.querySelector("#dialog-journey-date")).toBeNull();
  });

  it("deletes after confirmation and returns to Trips", async () => {
    backend({ onWrite: () => undefined });
    await renderRoutes("/trips/j1");
    await userEvent.click(await screen.findByRole("button", { name: /Delete/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete journey", hidden: true }));
    await waitFor(() => expect(writes()[0]).toEqual(["/api/journeys/j1", { method: "DELETE" }]));
    expect(await screen.findByRole("heading", { name: "Trips" })).toBeInTheDocument();
  });
});

describe("templates", () => {
  it("plans a dated journey from a template", async () => {
    backend({ onWrite: (path) => (path === "/api/journey-templates/t1/journeys" ? { journey: detail(), warnings: [] } : undefined) });
    await renderRoutes("/trips/templates/t1");
    expect(await screen.findByRole("heading", { name: "Home trip" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Plan a journey from this template/ }));
    fireEvent.change(screen.getByLabelText("Journey date", { selector: "#dialog-journey-date" }), { target: { value: FUTURE } });
    await userEvent.click(screen.getByRole("button", { name: "Create journey", hidden: true }));
    await waitFor(() => expect(writes()[0]).toEqual(["/api/journey-templates/t1/journeys", { method: "POST", body: { journeyDate: FUTURE } }]));
    expect(await screen.findByRole("heading", { name: "Diwali trip" })).toBeInTheDocument();
  });

  it("requires a template name, but not a date", () => {
    const d = { ...emptyDraft(), from: { code: "BCT", name: "Mumbai Central", state: null }, to: { code: "NDLS", name: "New Delhi", state: null } };
    expect(validateStep("route", d, { mode: "template", passengerLimit: null })).toEqual({ name: "Give this template a name" });
    expect(validateStep("route", { ...d, name: "Home" }, { mode: "template", passengerLimit: null })).toEqual({});
    expect(validateStep("passengers", d, { mode: "template", passengerLimit: null })).toEqual({});
    expect(validateStep("passengers", d, { mode: "journey", passengerLimit: null }).passengers).toBe("Select at least one passenger");
  });
});
