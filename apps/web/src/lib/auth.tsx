import { useQueryClient } from "@tanstack/react-query";
import { createContext, Fragment, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { SessionState, SessionUser } from "@tatkalflow/shared/client";
import { api, session } from "./api";
import { bindQueryCacheToSession } from "./session-cache";

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
  const queryClient = useQueryClient();
  // One boundary for all cached data: a change of signed-in user clears it.
  useEffect(() => bindQueryCacheToSession(queryClient, session), [queryClient]);

  const state = useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.getState(),
  );

  useEffect(() => {
    if (session.getState().status === "unknown") {
      void session.bootstrap(() => api<SessionUser & { fullName: string | null }>("/api/me"));
    }
  }, []);

  // Keyed by the signed-in identity: when it changes, every screen re-mounts and
  // reads the already-purged cache, and no component keeps the previous user's
  // data in local state. Token refreshes keep the same identity (no re-mount).
  const identity = state.status === "authenticated" ? `user:${state.user?.id ?? ""}` : state.status;
  return (
    <AuthContext.Provider value={{ state, signOut: () => session.logout() }}>
      <Fragment key={identity}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
