import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { SessionState, SessionUser } from "@tatkalflow/shared/client";
import { api, session } from "./api";

interface AuthContextValue {
  state: SessionState;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Where to go right after sign-in. Set by the OTP screen *before* the session
// flips to authenticated, because that flip re-renders the signed-out guard.
let postSignInRedirect: string | null = null;
export function setPostSignInRedirect(path: string | null) {
  postSignInRedirect = path;
}
export function peekPostSignInRedirect(): string | null {
  return postSignInRedirect;
}
export function clearPostSignInRedirect() {
  postSignInRedirect = null;
}

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
