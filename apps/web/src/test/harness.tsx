import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { SessionState } from "@tatkalflow/shared/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";

/** Controllable stand-in for the shared SessionManager. */
export function fakeSession(initial: SessionState) {
  let state = initial;
  const listeners = new Set<(s: SessionState) => void>();
  return {
    getState: () => state,
    subscribe: (l: (s: SessionState) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(next: SessionState) {
      state = next;
      listeners.forEach((l) => l(next));
    },
    bootstrap: vi.fn(async () => state),
    logout: vi.fn(async () => undefined),
    acceptSignIn: vi.fn(),
  };
}

export async function renderRoutes(path: string) {
  const { routes } = await import("../App");
  const { AuthProvider } = await import("../lib/auth");
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

export function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
