import { BookOpenCheck, Home, TrainFront, UserRound, Users, WifiOff } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { cx, Spinner } from "../ui";

export const NAV_ITEMS = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/trips", label: "Trips", icon: TrainFront },
  { to: "/passengers", label: "Passengers", icon: Users },
  { to: "/bookings", label: "Bookings", icon: BookOpenCheck },
  { to: "/profile", label: "Profile", icon: UserRound },
] as const;

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function AppShell() {
  const online = useOnline();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-surface focus:p-3">
        Skip to content
      </a>

      {/* Side rail (tablet/desktop) */}
      <nav aria-label="Main" className="sticky top-0 hidden h-dvh flex-col gap-1 border-r border-border bg-surface p-4 md:flex">
        <p className="mb-6 px-3 pt-2 text-lg font-bold tracking-tight">
          Tatkal<span className="text-accent">Flow</span>
        </p>
        {NAV_ITEMS.map(({ to, label, icon: Icon, ...rest }) => (
          <NavLink
            key={to}
            to={to}
            end={"end" in rest}
            className={({ isActive }) =>
              cx("flex min-h-12 items-center gap-3 rounded-2xl px-3 font-medium", isActive ? "bg-surface-2 text-primary" : "text-muted hover:bg-surface-2 hover:text-text")
            }
          >
            <Icon aria-hidden className="size-5" /> {label}
          </NavLink>
        ))}
        <p className="mt-auto px-3 text-xs text-muted">Independent app. Not affiliated with IRCTC or Indian Railways.</p>
      </nav>

      <div className="flex min-h-dvh flex-col">
        {!online && (
          <div role="status" className="pt-safe-2 sticky top-0 z-20 flex items-center justify-center gap-2 bg-warning-soft px-4 pb-2 text-sm font-medium text-warning">
            <WifiOff aria-hidden className="size-4" /> You're offline. Saved screens still open; changes need a connection.
          </div>
        )}
        <main id="main" className="pt-safe-6 mx-auto w-full max-w-2xl flex-1 px-4 pb-28 md:pb-10">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* Bottom navigation (phones) */}
      <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:hidden">
        <ul className="mx-auto grid max-w-2xl grid-cols-5">
          {NAV_ITEMS.map(({ to, label, icon: Icon, ...rest }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={"end" in rest}
                className={({ isActive }) => cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive ? "text-primary" : "text-muted")}
              >
                {({ isActive }) => (
                  <>
                    <Icon aria-hidden className={cx("size-6", isActive && "stroke-[2.4]")} />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
