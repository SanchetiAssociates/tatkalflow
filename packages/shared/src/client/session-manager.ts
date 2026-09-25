/**
 * Browser session manager shared by all tabs of the web app.
 *
 * Problem: refresh tokens rotate on every use, and a replayed (already
 * rotated) token revokes the whole session family. Two tabs refreshing at the
 * same moment with the same cookie would look like theft.
 *
 * Solution (no weakening of theft detection):
 *  1. One refresh at a time per browser: all tabs take the same Web Lock
 *     ("tatkalflow-auth") before refreshing or logging out.
 *  2. The winner broadcasts the new access token on a BroadcastChannel;
 *     tabs that were waiting for the lock see a fresh token and skip their own
 *     refresh entirely.
 *  3. Within a tab, concurrent callers share one in-flight promise.
 *  4. Safety net for browsers without Web Locks: the server answers a
 *     same-device race with 409 REFRESH_IN_PROGRESS (never with tokens); the
 *     manager waits briefly and retries with the cookie the winner set.
 *
 * Access tokens live only in memory. The refresh token is an HttpOnly cookie
 * the manager never sees.
 */

export interface HttpResponseLike {
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; credentials: "include" | "same-origin" },
) => Promise<HttpResponseLike>;

export interface LockLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface ChannelLike {
  postMessage(message: SessionMessage): void;
  addEventListener(type: "message", listener: (event: { data: SessionMessage }) => void): void;
  close?(): void;
}

export type SessionMessage =
  | { type: "token"; accessToken: string; accessTokenExpiresAt: string; user?: SessionUser | null }
  | { type: "logout" };

export interface SessionUser {
  id: string;
  mobile: string;
  fullName: string | null;
}

export type SessionStatus = "unknown" | "authenticated" | "anonymous";

export interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
}

export interface SessionManagerOptions {
  apiBase?: string;
  fetch: FetchLike;
  lock?: LockLike;
  channel?: ChannelLike | null;
  now?: () => number;
  /** Refresh this long before expiry. */
  skewMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const LOCK_NAME = "tatkalflow-auth";
export const CSRF_HEADER = "x-tatkalflow-csrf";

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has ended. Please sign in again.");
    this.name = "SessionExpiredError";
  }
}

/** Fallback lock for environments without Web Locks (single tab only). */
export class InMemoryLock implements LockLike {
  private tail: Promise<unknown> = Promise.resolve();
  request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback, callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

export class SessionManager {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private state: SessionState = { status: "unknown", user: null };
  private inflight: Promise<string | null> | null = null;
  private listeners = new Set<(s: SessionState) => void>();
  private readonly apiBase: string;
  private readonly lock: LockLike;
  private readonly channel: ChannelLike | null;
  private readonly now: () => number;
  private readonly skewMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** Number of POST /api/auth/refresh calls this tab has sent (for tests/metrics). */
  refreshCalls = 0;

  constructor(private readonly opts: SessionManagerOptions) {
    this.apiBase = opts.apiBase ?? "";
    this.lock = opts.lock ?? new InMemoryLock();
    this.channel = opts.channel ?? null;
    this.now = opts.now ?? (() => Date.now());
    this.skewMs = opts.skewMs ?? 30_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.channel?.addEventListener("message", (event) => this.onMessage(event.data));
  }

  getState(): SessionState {
    return this.state;
  }

  subscribe(listener: (s: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: SessionState) {
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  private hasFreshToken(): boolean {
    return Boolean(this.accessToken) && this.expiresAt - this.skewMs > this.now();
  }

  private onMessage(msg: SessionMessage) {
    if (msg.type === "token") {
      const exp = Date.parse(msg.accessTokenExpiresAt);
      if (exp > this.expiresAt) {
        this.accessToken = msg.accessToken;
        this.expiresAt = exp;
        this.setState({ status: "authenticated", user: msg.user ?? this.state.user });
      }
    } else if (msg.type === "logout") {
      this.clearLocal();
    }
  }

  private clearLocal() {
    this.accessToken = null;
    this.expiresAt = 0;
    this.setState({ status: "anonymous", user: null });
  }

  /** Called after OTP verification succeeds in this tab. */
  acceptSignIn(tokens: { accessToken: string; accessTokenExpiresAt: string; user: SessionUser }) {
    this.accessToken = tokens.accessToken;
    this.expiresAt = Date.parse(tokens.accessTokenExpiresAt);
    this.setState({ status: "authenticated", user: tokens.user });
    this.channel?.postMessage({ type: "token", ...tokens });
  }

  /** A valid access token, refreshing if needed; null when signed out. */
  async getAccessToken(): Promise<string | null> {
    if (this.hasFreshToken()) return this.accessToken;
    return this.refresh();
  }

  /**
   * Single-flight refresh. `staleToken` lets a caller that just got a 401
   * force a refresh unless another caller has already replaced that token.
   */
  refresh(staleToken?: string | null): Promise<string | null> {
    if (this.inflight) return this.inflight;
    this.inflight = this.lock
      .request(LOCK_NAME, async () => {
        // While we waited for the lock another tab may have refreshed.
        const replaced = staleToken !== undefined && this.accessToken && this.accessToken !== staleToken;
        if ((staleToken === undefined && this.hasFreshToken()) || replaced) return this.accessToken;
        return this.refreshNow();
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async refreshNow(attempt = 0): Promise<string | null> {
    this.refreshCalls++;
    const res = await this.opts.fetch(`${this.apiBase}/api/auth/refresh`, {
      method: "POST",
      headers: { [CSRF_HEADER]: "1" },
      credentials: "include",
    });
    if (res.status === 200) {
      const body = (await res.json()) as { accessToken: string; accessTokenExpiresAt: string };
      this.accessToken = body.accessToken;
      this.expiresAt = Date.parse(body.accessTokenExpiresAt);
      this.setState({ status: "authenticated", user: this.state.user });
      this.channel?.postMessage({ type: "token", ...body, user: this.state.user });
      return body.accessToken;
    }
    if (res.status === 409 && attempt < 2) {
      // Same-browser race without Web Locks: the winner already set the new
      // cookie. Retry with it (or pick up the winner's broadcast).
      await this.sleep(250 * (attempt + 1));
      if (this.hasFreshToken()) return this.accessToken;
      return this.refreshNow(attempt + 1);
    }
    if (res.status === 401 || res.status === 403) {
      this.clearLocal();
      this.channel?.postMessage({ type: "logout" });
      return null;
    }
    throw new Error(`Refresh failed (${res.status})`);
  }

  /**
   * Logout takes the same lock as refresh, so it can never interleave with a
   * rotation in another tab.
   */
  async logout(): Promise<void> {
    await this.lock.request(LOCK_NAME, async () => {
      try {
        await this.opts.fetch(`${this.apiBase}/api/auth/logout`, {
          method: "POST",
          headers: { [CSRF_HEADER]: "1" },
          credentials: "include",
        });
      } finally {
        this.clearLocal();
        this.channel?.postMessage({ type: "logout" });
      }
    });
  }

  /**
   * Authenticated request. On 401, refreshes once (shared with any other
   * callers) and retries. Throws SessionExpiredError if the session is gone.
   */
  async request(path: string, init: { method?: string; body?: unknown } = {}): Promise<HttpResponseLike> {
    const send = (token: string) =>
      this.opts.fetch(`${this.apiBase}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        credentials: "same-origin",
      });

    const token = await this.getAccessToken();
    if (!token) throw new SessionExpiredError();
    const res = await send(token);
    if (res.status !== 401) return res;

    const renewed = await this.refresh(token);
    if (!renewed) throw new SessionExpiredError();
    const retry = await send(renewed);
    if (retry.status === 401) {
      this.clearLocal();
      throw new SessionExpiredError();
    }
    return retry;
  }

  /** Restore on page load: try the refresh cookie once. */
  async bootstrap(fetchUser: () => Promise<SessionUser | null>): Promise<SessionState> {
    const token = await this.getAccessToken().catch(() => null);
    if (!token) {
      this.clearLocal();
      return this.state;
    }
    const user = await fetchUser().catch(() => null);
    if (user) this.setState({ status: "authenticated", user });
    return this.state;
  }

  dispose() {
    this.channel?.close?.();
    this.listeners.clear();
  }
}
