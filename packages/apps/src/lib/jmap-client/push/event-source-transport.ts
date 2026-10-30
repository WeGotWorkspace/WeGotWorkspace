import { isStateChange, type PushSink, type PushTransport } from "./push-transport";
import { readSseResponse } from "./sse-reader";

export type PushTiming = {
  /** Reconnect interval until the server sends `retry:`. */
  retryMs: number;
  /** Reconnect interval while every tab of the browser is hidden. */
  hiddenRetryMs: number;
  /** Ceiling of the failure backoff. */
  maxBackoffMs: number;
  /** Wait after `501` or a response that is not an event stream: push is off on this server. */
  unavailableRetryMs: number;
  /** An early reconnect (`wake`) never starts sooner than this after the previous request. */
  wakeGapMs: number;
  /** Consecutive failures after which push counts as down. */
  downAfterFailures: number;
};

export const DEFAULT_PUSH_TIMING: PushTiming = {
  retryMs: 3_000,
  hiddenRetryMs: 30_000,
  maxBackoffMs: 60_000,
  unavailableRetryMs: 300_000,
  wakeGapMs: 2_000,
  downAfterFailures: 2,
};

/** Bounds of a server `retry:` the client accepts (the server clamps to the same). */
const MIN_RETRY_MS = 500;
const MAX_RETRY_MS = 600_000;

export type PushConnectivity = {
  online: () => boolean;
  subscribe: (listener: (online: boolean) => void) => () => void;
};

export type EventSourceTransportOptions = {
  /**
   * Expanded `eventSourceUrl` (for example `/jmap/events/*\/state/0`), or a
   * resolver that reads it from the JMAP session; null there means the server
   * offers no event source, and push stays off.
   */
  url: string | (() => Promise<string | null>);
  /** The authenticated fetch (bearer token, refresh on `401`). */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** `Last-Event-ID` for the next request, rebuilt from confirmed hashes. */
  lastEventId: () => Promise<string | null> | string | null;
  everyTabHidden?: () => Promise<boolean> | boolean;
  /** Push connected (`true`) or down; called on change only. */
  onStatus?: (connected: boolean) => void;
  connectivity: PushConnectivity;
  /** Called after a `401` the fetch could not fix, before the next attempt. */
  refreshAuth?: () => Promise<void>;
  headers?: () => Record<string, string>;
  timing?: Partial<PushTiming>;
};

type Outcome =
  | { kind: "ok" }
  | { kind: "rate-limited"; waitMs: number | null }
  | { kind: "unavailable" }
  | { kind: "unauthorized" }
  | { kind: "failed" }
  | { kind: "aborted" };

/** Why the loop waits: a wake only shortens `retry`; online again ends all but `rate-limit`. */
type WaitKind = "retry" | "backoff" | "rate-limit" | "unavailable" | "offline";

type Wait = { until: number; kind: WaitKind; timer: ReturnType<typeof setTimeout> | undefined };

/**
 * The JMAP event source in short-burst form (#1660): every response ends at
 * once with a `state` event or only `retry:`. The transport reads it, hands
 * each StateChange to the hub and reconnects after the server's `retry`, or
 * later while every tab is hidden. It stops while offline and reconnects when
 * the browser is back online. `429`, `501` and repeated failures report push
 * as down, so the app polls return to their normal interval.
 */
export class EventSourceTransport implements PushTransport {
  #options: EventSourceTransportOptions;
  #timing: PushTiming;
  #retryMs: number;
  #failures = 0;
  #status: boolean | null = null;
  #running = false;
  #request: AbortController | null = null;
  #lastStartedAt = Number.NEGATIVE_INFINITY;
  #wakeQueued = false;
  #wait: Wait | null = null;
  #resolveWait: (() => void) | null = null;
  /** End of a `429` wait; going offline and back does not shorten it. */
  #rateLimitedUntil = 0;

  constructor(options: EventSourceTransportOptions) {
    this.#options = options;
    this.#timing = { ...DEFAULT_PUSH_TIMING, ...options.timing };
    this.#retryMs = this.#timing.retryMs;
  }

  start(sink: PushSink): () => void {
    if (this.#running) return () => this.#stop();
    this.#running = true;
    const unsubscribe = this.#options.connectivity.subscribe((online) => {
      if (!online) {
        this.#request?.abort();
        this.#report(false);
      }
      this.#interruptWait({ online });
    });
    void this.#loop(sink);
    return () => {
      unsubscribe();
      this.#stop();
    };
  }

  /** Reconnect sooner than `retry` (mesh `check-now`, a tab became visible). */
  reconnectNow(_reason: string): void {
    if (!this.#running) return;
    if (this.#request) {
      this.#wakeQueued = true;
      return;
    }
    const wait = this.#wait;
    if (wait?.kind !== "retry") return;
    const earliest = Math.max(Date.now(), this.#lastStartedAt + this.#timing.wakeGapMs);
    if (earliest < wait.until) this.#arm(earliest - Date.now(), "retry");
  }

  #stop(): void {
    this.#running = false;
    this.#request?.abort();
    this.#interruptWait({ online: true });
  }

  async #loop(sink: PushSink): Promise<void> {
    while (this.#running) {
      if (!this.#options.connectivity.online()) {
        this.#report(false);
        await this.#sleep(Number.POSITIVE_INFINITY, "offline");
        continue;
      }
      const limited = this.#rateLimitedUntil - Date.now();
      if (limited > 0) {
        await this.#sleep(limited, "rate-limit");
        continue;
      }
      const outcome = await this.#once(sink);
      if (!this.#running) return;
      await this.#sleep(...(await this.#delayAfter(outcome)));
    }
  }

  async #once(sink: PushSink): Promise<Outcome> {
    const request = new AbortController();
    this.#request = request;
    this.#lastStartedAt = Date.now();
    this.#wakeQueued = false;
    try {
      const headers = new Headers(this.#options.headers?.());
      headers.set("Accept", "text/event-stream");
      const url =
        typeof this.#options.url === "string" ? this.#options.url : await this.#options.url();
      if (url === null) return { kind: "unavailable" };
      const id = await this.#options.lastEventId();
      if (id) headers.set("Last-Event-ID", id);
      const response = await this.#options.fetch(url, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: request.signal,
      });
      return await this.#read(response, sink);
    } catch {
      // Network error, session renewal failure or a body cut off: all retry with backoff.
      return request.signal.aborted ? { kind: "aborted" } : { kind: "failed" };
    } finally {
      if (this.#request === request) this.#request = null;
    }
  }

  async #read(response: Response, sink: PushSink): Promise<Outcome> {
    const outcome = unreadOutcome(response);
    if (outcome) {
      // An unread body keeps the connection checked out; free it for the next request.
      await response.body?.cancel().catch(() => undefined);
      return outcome;
    }
    await readSseResponse(response, {
      onRetry: (ms) => {
        this.#retryMs = Math.min(MAX_RETRY_MS, Math.max(MIN_RETRY_MS, ms));
      },
      onEvent: (event) => {
        if (event.event !== "state") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        if (isStateChange(parsed)) sink.deliver(parsed, event.id ?? "");
      },
    });
    return { kind: "ok" };
  }

  /** [delay, kind] of the wait after an attempt. */
  async #delayAfter(outcome: Outcome): Promise<[number, WaitKind]> {
    switch (outcome.kind) {
      case "ok": {
        this.#failures = 0;
        this.#report(true);
        if (this.#wakeQueued) {
          return [Math.max(0, this.#lastStartedAt + this.#timing.wakeGapMs - Date.now()), "retry"];
        }
        const hidden = (await this.#options.everyTabHidden?.()) ?? false;
        const delay = hidden ? Math.max(this.#retryMs, this.#timing.hiddenRetryMs) : this.#retryMs;
        return [delay, "retry"];
      }
      case "aborted":
        return [0, "backoff"];
      case "unavailable":
        this.#failures = 0;
        this.#report(false);
        return [this.#timing.unavailableRetryMs, "unavailable"];
      case "rate-limited": {
        const backoff = this.#fail();
        this.#report(false);
        const delay = Math.max(outcome.waitMs ?? 0, backoff);
        this.#rateLimitedUntil = Date.now() + delay;
        return [delay, "rate-limit"];
      }
      case "unauthorized":
        await this.#options.refreshAuth?.().catch(() => undefined);
        return [this.#fail(), "backoff"];
      case "failed":
        return [this.#fail(), "backoff"];
    }
  }

  #fail(): number {
    this.#failures += 1;
    if (this.#failures >= this.#timing.downAfterFailures) this.#report(false);
    return Math.min(this.#timing.maxBackoffMs, this.#retryMs * 2 ** (this.#failures - 1));
  }

  #report(connected: boolean): void {
    if (this.#status === connected) return;
    this.#status = connected;
    this.#options.onStatus?.(connected);
  }

  #sleep(ms: number, kind: WaitKind): Promise<void> {
    if (!this.#running) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#resolveWait = resolve;
      this.#arm(ms, kind);
    });
  }

  #arm(ms: number, kind: WaitKind): void {
    if (this.#wait) clearTimeout(this.#wait.timer);
    const timer = Number.isFinite(ms)
      ? setTimeout(() => this.#endWait(), Math.max(0, ms))
      : undefined;
    this.#wait = { until: Date.now() + ms, kind, timer };
  }

  #endWait(): void {
    if (this.#wait) clearTimeout(this.#wait.timer);
    this.#wait = null;
    const resolve = this.#resolveWait;
    this.#resolveWait = null;
    resolve?.();
  }

  /** Offline ends any wait so the loop parks; online again ends all but a rate limit. */
  #interruptWait({ online }: { online: boolean }): void {
    if (!this.#wait) return;
    if (!this.#running || !online || this.#wait.kind !== "rate-limit") this.#endWait();
  }
}

/** The outcome of a response that is not an event stream to read, or null when it is one. */
function unreadOutcome(response: Response): Outcome | null {
  if (response.status === 429) {
    return { kind: "rate-limited", waitMs: retryAfterMs(response.headers.get("Retry-After")) };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  if (response.status >= 500 && response.status !== 501) return { kind: "failed" };
  const type = response.headers.get("Content-Type") ?? "";
  if (!response.ok || !type.toLowerCase().startsWith("text/event-stream")) {
    return { kind: "unavailable" };
  }
  return null;
}

/** `Retry-After` in seconds or as an HTTP date. */
function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}
