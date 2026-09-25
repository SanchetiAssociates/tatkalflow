import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../../lib/auth";

function Splash() {
  return (
    <div role="status" aria-label="Loading TatkalFlow" className="grid min-h-dvh place-items-center">
      <p className="animate-pulse text-2xl font-bold tracking-tight">
        Tatkal<span className="text-accent">Flow</span>
      </p>
    </div>
  );
}

/** Signed-in only. While the session is being restored, show a splash (no flash of the login screen). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === "unknown") return <Splash />;
  if (state.status === "anonymous") return <Navigate to="/welcome" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Signed-out only (welcome/login). */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === "unknown") return <Splash />;
  if (state.status === "authenticated") return <Navigate to="/" replace />;
  return <>{children}</>;
}
