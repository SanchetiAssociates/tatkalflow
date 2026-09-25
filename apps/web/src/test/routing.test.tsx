import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (path: string) => {
    if (path === "/api/me") return { id: "u1", mobile: "+919820012345", fullName: "Siddharth Test", email: null, notificationPreferences: { push: true, email: false, sms: false } };
    if (path === "/api/journeys" || path === "/api/passengers") return [];
    if (path === "/api/rules/active") return { enforcement: false, gaps: [{ ruleKey: "tatkal.ac.opening_time", state: "UNVERIFIED" }] };
    if (path === "/api/stations/mine") return { favourites: [], recents: [] };
    throw new Error(`unexpected ${path}`);
  });
});

describe("protected routes", () => {
  it("sends signed-out users to the welcome screen", async () => {
    mocks.session = fakeSession({ status: "anonymous", user: null });
    await renderRoutes("/passengers");
    expect(await screen.findByText("Be Ready When Tatkal Opens.")).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalledWith("/api/passengers");
  });

  it("shows a splash, not the login screen, while the session is being restored", async () => {
    mocks.session = fakeSession({ status: "unknown", user: null });
    await renderRoutes("/");
    expect(screen.getByRole("status", { name: /loading tatkalflow/i })).toBeInTheDocument();
    expect(screen.queryByText("Be Ready When Tatkal Opens.")).not.toBeInTheDocument();
  });

  it("renders the app shell with the five sections for signed-in users", async () => {
    mocks.session = fakeSession({ status: "authenticated", user: { id: "u1", mobile: "+919820012345", fullName: "Siddharth Test" } });
    await renderRoutes("/");
    expect(await screen.findByRole("heading", { name: "Siddharth" })).toBeInTheDocument();
    const [nav] = screen.getAllByRole("navigation", { name: "Main" });
    for (const label of ["Home", "Trips", "Passengers", "Bookings", "Profile"]) {
      expect(within(nav!).getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(await screen.findByText(/Tatkal timings not yet verified/)).toBeInTheDocument();
  });

  it("redirects signed-in users away from the welcome screen", async () => {
    mocks.session = fakeSession({ status: "authenticated", user: { id: "u1", mobile: "+919820012345", fullName: null } });
    await renderRoutes("/welcome");
    await waitFor(() => expect(screen.queryByText("Be Ready When Tatkal Opens.")).not.toBeInTheDocument());
    expect(await screen.findByRole("heading", { name: "Upcoming" })).toBeInTheDocument();
  });

  it("signing out elsewhere returns this tab to the welcome screen", async () => {
    mocks.session = fakeSession({ status: "authenticated", user: { id: "u1", mobile: "+919820012345", fullName: null } });
    await renderRoutes("/trips");
    expect(await screen.findByRole("heading", { name: "Trips" })).toBeInTheDocument();
    mocks.session.set({ status: "anonymous", user: null });
    expect(await screen.findByText("Be Ready When Tatkal Opens.")).toBeInTheDocument();
  });

  it("shows empty states with a clear next action", async () => {
    mocks.session = fakeSession({ status: "authenticated", user: { id: "u1", mobile: "+919820012345", fullName: null } });
    await renderRoutes("/passengers");
    expect(await screen.findByText("No passengers yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add passenger" })).toHaveAttribute("href", "/passengers/new");
  });

  it("shows an error state with retry when loading fails", async () => {
    mocks.session = fakeSession({ status: "authenticated", user: { id: "u1", mobile: "+919820012345", fullName: null } });
    mocks.api.mockImplementation(async () => {
      throw new Error("boom");
    });
    await renderRoutes("/trips");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your trips.");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
