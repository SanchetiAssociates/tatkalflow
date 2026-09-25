import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { SessionState } from "@tatkalflow/shared/client";

/**
 * Query roots whose data is the same for every user (reference data and
 * public search results). Everything else is treated as private to the
 * signed-in user. Deny by default: a new query is purged on user change
 * unless it is added here deliberately.
 */
export const SHARED_QUERY_ROOTS: ReadonlySet<string> = new Set(["journey-options", "rules", "trains"]);

export function isSharedQuery(key: QueryKey): boolean {
  const [root, sub] = key;
  if (typeof root !== "string") return false;
  if (root === "stations") return sub === "search"; // station search is shared; ["stations","mine"] is private
  return SHARED_QUERY_ROOTS.has(root);
}

/** Whose data may be in the cache: the signed-in user's ID, or null. */
const identityOf = (s: SessionState) => (s.status === "authenticated" ? (s.user?.id ?? null) : null);

/**
 * Remove every private query's data (cancelling in-flight requests first) and
 * all mutation state. Screens already on display are notified too, so none
 * keeps showing the previous result. With `refetchForNewUser` (a new user signed
 * in), screens on display load that user's data; after sign-out nothing is
 * requested.
 */
export function purgeUserData(qc: QueryClient, opts: { refetchForNewUser: boolean }): void {
  const predicate = (q: { queryKey: QueryKey }) => !isSharedQuery(q.queryKey);
  void qc.cancelQueries({ predicate });
  if (opts.refetchForNewUser) {
    void qc.resetQueries({ predicate }); // clears data; active queries refetch as the new user
    qc.removeQueries({ predicate, type: "inactive" });
  } else {
    for (const q of qc.getQueryCache().findAll({ predicate })) q.reset(); // clears data, no request
    qc.removeQueries({ predicate });
  }
  qc.getMutationCache().clear();
}

interface SessionLike {
  getState(): SessionState;
  subscribe(listener: (s: SessionState) => void): () => unknown;
}

/**
 * The cache/session boundary. Whenever the signed-in identity changes
 * (sign-out, sign-in, or another tab switching to a different account), all
 * private cached data is removed before anything re-renders, so one user's
 * data can never be shown to the next. Token refreshes for the same user
 * don't touch the cache.
 *
 * Session listeners run synchronously when the session state changes, ahead
 * of React's re-render.
 */
export function bindQueryCacheToSession(qc: QueryClient, session: SessionLike): () => void {
  let identity = identityOf(session.getState());
  const unsubscribe = session.subscribe((state) => {
    if (state.status === "unknown") return; // still restoring; nothing has changed hands
    const next = identityOf(state);
    if (next !== identity) purgeUserData(qc, { refetchForNewUser: next !== null });
    identity = next;
  });
  return () => void unsubscribe();
}
