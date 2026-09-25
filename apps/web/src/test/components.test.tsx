import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PassengerDto } from "@tatkalflow/shared";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "./harness";

const mocks = vi.hoisted(() => ({ api: vi.fn(), publicPost: vi.fn() }));
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: (...a: unknown[]) => mocks.api(...a), publicPost: (...a: unknown[]) => mocks.publicPost(...a) };
});

import { PassengerCard } from "../features/passengers/PassengerCard";
import { StationPicker } from "../features/stations/StationPicker";
import VerifyOtp from "../features/auth/VerifyOtp";
import { getTheme, setTheme } from "../lib/theme";

beforeEach(() => {
  mocks.api.mockReset();
  mocks.publicPost.mockReset();
});

describe("XSS-safe rendering", () => {
  it("renders hostile passenger names as inert text", () => {
    const hostile = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    const p: PassengerDto = {
      id: "p1",
      name: hostile,
      age: 30,
      gender: "MALE",
      berthPreference: "LOWER",
      foodPreference: "VEG",
      seniorCitizenOptIn: false,
      childBerthOptIn: true,
      lastUsedAt: null,
      createdAt: "",
      updatedAt: "",
    };
    const { container } = render(
      <MemoryRouter>
        <ul>
          <PassengerCard passenger={p} onDelete={() => undefined} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("passenger-name").textContent).toBe(hostile);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe("StationPicker", () => {
  it("searches, supports keyboard selection and announces the choice", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/stations/mine") return { favourites: [{ code: "BCT", name: "Mumbai Central", state: "Maharashtra" }], recents: [] };
      if (path.startsWith("/api/stations/search")) {
        return {
          datasetVersion: "v1",
          results: [
            { code: "NDLS", name: "New Delhi", state: "Delhi" },
            { code: "DLI", name: "Delhi Junction", state: "Delhi" },
          ],
        };
      }
      throw new Error(path);
    });
    const onChange = vi.fn();
    renderWithQuery(<StationPicker label="To" value={null} onChange={onChange} />);
    const box = screen.getByRole("combobox", { name: "To" });
    await userEvent.click(box);
    expect(await screen.findByRole("option", { name: /Mumbai Central/ })).toBeInTheDocument(); // favourites when empty

    await userEvent.type(box, "delhi");
    await screen.findByRole("option", { name: /Delhi Junction/ });
    expect(mocks.api).toHaveBeenCalledWith("/api/stations/search?q=delhi&limit=8");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Delhi Junction/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ code: "DLI", name: "Delhi Junction", state: "Delhi" });
  });

  it("Enter in the search box never submits the surrounding form", async () => {
    mocks.api.mockImplementation(async (path: string) =>
      path === "/api/stations/mine" ? { favourites: [], recents: [] } : new Promise(() => undefined), // search never resolves
    );
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderWithQuery(
      <form onSubmit={onSubmit}>
        <StationPicker label="To" value={null} onChange={() => undefined} />
      </form>,
    );
    await userEvent.type(screen.getByRole("combobox", { name: "To" }), "ndls{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("says clearly when the station list isn't installed", async () => {
    mocks.api.mockImplementation(async (path: string) =>
      path === "/api/stations/mine" ? { favourites: [], recents: [] } : { datasetVersion: null, results: [] },
    );
    renderWithQuery(<StationPicker label="From" value={null} onChange={() => undefined} />);
    await userEvent.type(screen.getByRole("combobox", { name: "From" }), "mum");
    expect(await screen.findByText(/station list isn't installed/i)).toBeInTheDocument();
  });

  it("encodes the query (no injection into the URL)", async () => {
    mocks.api.mockResolvedValue({ datasetVersion: "v1", results: [], favourites: [], recents: [] });
    renderWithQuery(<StationPicker label="From" value={null} onChange={() => undefined} />);
    await userEvent.type(screen.getByRole("combobox", { name: "From" }), "a&limit=999");
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/stations/search?q=a%26limit%3D999&limit=8"));
  });
});

describe("OTP screen", () => {
  it("validates the code locally before calling the server", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login/verify", state: { otpSessionId: "s1", mobile: "+919820012345", expiresAt: new Date(Date.now() + 300_000).toISOString(), resendAvailableAt: new Date(Date.now() + 30_000).toISOString() } }]}>
        <VerifyOtp />
      </MemoryRouter>,
    );
    const input = screen.getByLabelText("6-digit code");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    await userEvent.type(input, "12ab3");
    expect(input).toHaveValue("123");
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Resend code in/ })).toBeDisabled();
    expect(mocks.publicPost).not.toHaveBeenCalled();
    expect(screen.getByText(/\+91 ••••• 12345/)).toBeInTheDocument();
  });
});

describe("theme", () => {
  it("switches explicitly and falls back to system", () => {
    setTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(getTheme()).toBe("dark");
    setTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(getTheme()).toBe("system");
  });
});
