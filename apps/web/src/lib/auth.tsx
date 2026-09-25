import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { SessionState, SessionUser } from "@tatkalflow/shared/client";
import { api, session } from "./api";

interface AuthContextValue {
  state: SessionState;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.getState(),
  );

  useEffect(() => {
    if (session.getState().status === "unknown") {
      void session.bootstrap(() => api<SessionUser & { fullName: string | null }>("/api/me"));
    }
  }, []);

  return <AuthContext.Provider value={{ state, signOut: () => session.logout() }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
