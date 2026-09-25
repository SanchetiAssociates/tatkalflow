import {
  InMemoryLock,
  SessionManager,
  type ChannelLike,
  type FetchLike,
  type LockLike,
  type SessionMessage,
} from "@tatkalflow/shared/client";
import type { Harness } from "./harness.js";

/** Stand-in for BroadcastChannel: delivers to every *other* member, asynchronously. */
class ChannelHub {
  private members = new Set<SimChannel>();
  join(): SimChannel {
    const ch = new SimChannel(this);
    this.members.add(ch);
    return ch;
  }
  deliver(from: SimChannel, msg: SessionMessage) {
    for (const m of this.members) if (m !== from) queueMicrotask(() => m.emit(msg));
  }
  leave(ch: SimChannel) {
    this.members.delete(ch);
  }
}

class SimChannel implements ChannelLike {
  private listeners: Array<(e: { data: SessionMessage }) => void> = [];
  constructor(private hub: ChannelHub) {}
  postMessage(message: SessionMessage) {
    this.hub.deliver(this, structuredClone(message));
  }
  addEventListener(_t: "message", l: (e: { data: SessionMessage }) => void) {
    this.listeners.push(l);
  }
  emit(msg: SessionMessage) {
    for (const l of this.listeners) l({ data: msg });
  }
  close() {
    this.hub.leave(this);
  }
}

/**
 * One simulated browser profile: a cookie jar shared by all its tabs, a fixed
 * IP + user agent, one Web Lock namespace and one BroadcastChannel namespace.
 * Requests go through the real Fastify app via inject().
 */
export class SimBrowser {
  readonly cookies = new Map<string, string>();
  readonly lock = new InMemoryLock();
  private hub = new ChannelHub();
  /** Every /api/auth/refresh status code this browser received, in order. */
  readonly refreshStatuses: number[] = [];

  constructor(
    private h: Harness,
    readonly ip = "203.0.113.10",
    readonly userAgent = "Mozilla/5.0 (iPhone; TatkalFlow test)",
  ) {}

  fetch: FetchLike = async (url, init) => {
    const isAuthPath = url.startsWith("/api/auth");
    const res = await this.h.app.inject({
      method: init.method as "GET",
      url,
      headers: { ...init.headers, "user-agent": this.userAgent, origin: "http://localhost:5173" },
      cookies: isAuthPath ? Object.fromEntries(this.cookies) : {},
      ...(init.body !== undefined ? { payload: init.body } : {}),
      remoteAddress: this.ip,
    });
    for (const c of res.cookies as Array<{ name: string; value: string; expires?: Date; maxAge?: number }>) {
      const expired = c.value === "" || (c.expires && c.expires.getTime() <= Date.now()) || c.maxAge === 0;
      if (expired) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    if (url === "/api/auth/refresh") this.refreshStatuses.push(res.statusCode);
    return { status: res.statusCode, json: async () => res.json() };
  };

  /** Open a tab. `lock` can be overridden to simulate a browser without Web Locks. */
  tab(opts: { lock?: LockLike } = {}): SessionManager {
    return new SessionManager({
      fetch: this.fetch,
      lock: opts.lock ?? this.lock,
      channel: this.hub.join(),
      now: () => this.h.clock.now().getTime(),
      sleep: async () => {},
    });
  }

  /** Sign in through the public API in the given tab (mock OTP). */
  async signIn(tab: SessionManager, mobile: string) {
    const req = await this.fetch("/api/auth/otp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile }),
      credentials: "include",
    });
    const { otpSessionId } = (await req.json()) as { otpSessionId: string };
    const code = this.h.otp.lastCodeFor(`+91${mobile}`)!;
    const res = await this.fetch("/api/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otpSessionId, code }),
      credentials: "include",
    });
    const body = (await res.json()) as { accessToken: string; accessTokenExpiresAt: string; user: { id: string; mobile: string; fullName: string | null } };
    tab.acceptSignIn(body);
    return body;
  }
}
