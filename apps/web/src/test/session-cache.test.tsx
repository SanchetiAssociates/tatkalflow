import { act, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PassengerDto } from "@tatkalflow/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSession } from "./harness";

/**
 * F1 regression: cached data must never cross from one signed-in user to the
 * next in the same tab. These tests use the production QueryClient settings
 * (createQueryClient) and switch users without reloading the app.
 */

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

const passenger = (id: string, name: string): PassengerDto => ({
  id,
  name,
  age: 40,
  gender: "FEMALE",
  berthPreference: "NO_PREFERENCE",
  foodPreference: "NO_PREFERENCE",
  seniorCitizenOptIn: false,
  childBerthOptIn: true,
  lastUsedAt: null,
  createdAt: "",
  updatedAt: "",
});
const USER_A = { id: "user-a", mobile: "+919800000001", fullName: "Alice" };
const USER_B = { id: "user-b", mobile: "+919800000002", fullName: "Bina" };
const DATA: Record<string, PassengerDto[]> = { [USER_A.id]: [passenger("pa", "Alice Private")], [USER_B.id]: [passenger("pb", "Bina Own")] };

/** The fake server answers as whoever is signed in; a user's response can be held back. */
let signedIn: string | null = null;
const held = new Map<string, (v: unknown) => void>();
function backend(holdFor: string | null = null) {
  mocks.api.mockImplementation(async (path: string) => {
    if (path === "/api/passengers") {
      const who = signedIn!;
      if (who === holdFor) return new Promise((resolve) => held.set(who, () => resolve(DATA[who])));
      return DATA[who];
    }
    throw new Error(`unexpected ${path}`);
  });
}

async function renderApp(path: string) {
  const { routes, createQueryClient } = await import("../App");
  const { AuthProvider } = await import("../lib/auth");
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = createQueryClient(); // production cache settings (30 s freshness)
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { router, qc };
}

function signInAs(user: typeof USER_A) {
  signedIn = user.id;
  act(() => mocks.session.set({ status: "authenticated", user }));
}
function signOut() {
  signedIn = null;
  act(() => mocks.session.set({ status: "anonymous", user: null }));
}
const passengerCalls = () => mocks.api.mock.calls.filter(([p]) => p === "/api/passengers").length;

beforeEach(() => {
  mocks.api.mockReset();
  held.clear();
  signedIn = USER_A.id;
  mocks.session = fakeSession({ status: "authenticated", user: USER_A });
});

describe("query cache isolation between users (F1)", () => {
  it("user B never sees user A's cached passengers after A signs out", async () => {
    backend(USER_B.id); // B's response is held, so we can look at the screen while it loads
    const { router } = await renderApp("/passengers");
    expect(await screen.findByText("Alice Private")).toBeInTheDocument();

    signOut();
    expect(await screen.findByText("Be Ready When Tatkal Opens.")).toBeInTheDocument();

    signInAs(USER_B);
    await act(() => router.navigate("/passengers")); // in-app navigation, no reload
    // While B's request is in flight, nothing of A's may be on screen.
    expect(screen.queryByText("Alice Private")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading passengers" })).toBeInTheDocument();

    await act(async () => held.get(USER_B.id)!(undefined));
    expect(await screen.findByText("Bina Own")).toBeInTheDocument();
    expect(screen.queryByText("Alice Private")).not.toBeInTheDocument();
  });

  it("switching straight from A to B (e.g. a sign-in in another tab) also clears A's data", async () => {
    backend(USER_B.id);
    await renderApp("/passengers");
    expect(await screen.findByText("Alice Private")).toBeInTheDocument();

    signInAs(USER_B); // no signed-out state in between
    expect(screen.queryByText("Alice Private")).not.toBeInTheDocument();
    await act(async () => held.get(USER_B.id)!(undefined));
    expect(await screen.findByText("Bina Own")).toBeInTheDocument();
  });

  it("user A's data is fetched again (not lost) when A signs back in", async () => {
    backend();
    const { router } = await renderApp("/passengers");
    expect(await screen.findByText("Alice Private")).toBeInTheDocument();
    const before = passengerCalls();

    signOut();
    signInAs(USER_A);
    await act(() => router.navigate("/passengers"));
    expect(await screen.findByText("Alice Private")).toBeInTheDocument();
    expect(passengerCalls()).toBe(before + 1); // a fresh request, not a leftover cache entry
  });
});

describe("bindQueryCacheToSession", () => {
  async function setup() {
    const { QueryClient } = await import("@tanstack/react-query");
    const { bindQueryCacheToSession } = await import("../lib/session-cache");
    const qc = new QueryClient();
    const session = fakeSession({ status: "authenticated", user: USER_A });
    const seed = () => {
      for (const key of [["passengers"], ["journeys"], ["journeys", "j1"], ["journey-templates"], ["me"], ["irctc"], ["stations", "mine"], ["phase5-future-private-query"]]) {
        qc.setQueryData(key, "private");
      }
      for (const key of [["journey-options"], ["rules"], ["trains", "search", "sample", "", ""], ["stations", "search", "bct"]]) qc.setQueryData(key, "shared");
    };
    seed();
    const unbind = bindQueryCacheToSession(qc, session);
    const keys = () => qc.getQueryCache().findAll({ predicate: (q) => q.state.data !== undefined }).map((q) => JSON.stringify(q.queryKey)).sort();
    return { qc, session, seed, unbind, keys };
  }
  const SHARED = ['["journey-options"]', '["rules"]', '["stations","search","bct"]', '["trains","search","sample","",""]'];

  it("on sign-out keeps only shared reference data; every private query (including future ones) is dropped", async () => {
    const { session, keys } = await setup();
    session.set({ status: "anonymous", user: null });
    expect(keys()).toEqual(SHARED);
  });

  it("on a switch to another user drops private data too", async () => {
    const { session, keys } = await setup();
    session.set({ status: "authenticated", user: USER_B });
    expect(keys()).toEqual(SHARED);
  });

  it("a token refresh for the same user changes nothing", async () => {
    const { session, keys } = await setup();
    const before = keys();
    session.set({ status: "authenticated", user: { ...USER_A } });
    expect(keys()).toEqual(before);
    expect(before).toContain('["passengers"]');
  });

  it("clears pending mutation state (which can hold the previous user's form input)", async () => {
    const { qc, session } = await setup();
    await qc.getMutationCache().build(qc, { mutationFn: async (v: unknown) => v }).execute({ name: "Alice Private" });
    expect(qc.getMutationCache().getAll()).toHaveLength(1);
    session.set({ status: "anonymous", user: null });
    expect(qc.getMutationCache().getAll()).toHaveLength(0);
  });

  it("stops listening once unbound", async () => {
    const { session, keys, unbind } = await setup();
    unbind();
    session.set({ status: "anonymous", user: null });
    expect(keys()).toContain('["passengers"]');
  });
});
