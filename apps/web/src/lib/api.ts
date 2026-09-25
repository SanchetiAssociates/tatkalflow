import { CSRF_HEADER, InMemoryLock, SessionExpiredError, SessionManager, type ChannelLike, type FetchLike, type LockLike } from "@tatkalflow/shared/client";

export { SessionExpiredError };

export interface ApiFieldError {
  path: string;
  message: string;
}

/** A user-safe API error. `message` comes from the server's public message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: ApiFieldError[] = [],
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const browserFetch: FetchLike = (url, init) => fetch(url, init);

function webLocks(): LockLike {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks) return new InMemoryLock();
  return { request: <T,>(name: string, cb: () => Promise<T>) => locks.request(name, cb) as Promise<T> };
}

function channel(): ChannelLike | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel("tatkalflow-session") as unknown as ChannelLike;
}

export const session = new SessionManager({ fetch: browserFetch, lock: webLocks(), channel: channel() });

async function toApiError(res: { status: number; json(): Promise<unknown> }): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; fields?: ApiFieldError[] } & Record<string, unknown> };
  const e = body.error ?? {};
  return new ApiError(res.status, e.code ?? "UNKNOWN", e.message ?? "Something went wrong. Please try again.", e.fields ?? [], e);
}

/** Authenticated JSON request through the shared session (handles refresh). */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res;
  try {
    res = await session.request(path, init);
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    throw new ApiError(0, "NETWORK", "You appear to be offline. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  if (res.status >= 400) throw await toApiError(res);
  return (await res.json()) as T;
}

/** Unauthenticated JSON POST (OTP request/verify). */
export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", [CSRF_HEADER]: "1" },
      body: JSON.stringify(body),
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "You appear to be offline. Check your connection and try again.");
  }
  if (res.status >= 400) throw await toApiError(res);
  return (await res.json()) as T;
}
