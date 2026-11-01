/**
 * One exclusive lock per name across every tab of this origin.
 *
 * Web Locks when the browser has them (secure contexts only). Otherwise a
 * localStorage record with a heartbeat, a BroadcastChannel release notice,
 * and polling: on an `http://` install that fallback is the normal path in
 * every tab. Waiters wait and take over when the holder releases or its
 * record goes stale. The task never runs outside a lock.
 *
 * Callers pick their own name. Two callers that can nest (the uploader calls
 * `wgwFetch`, which can take the token refresh lock) must never share one.
 */

export type CrossTabLockContext = {
  /** Aborts when the fallback lock was lost to another tab (stale takeover). */
  signal: AbortSignal;
};

export type CrossTabLockOptions = {
  /** Stop waiting. A task that already runs is not aborted by this signal. */
  signal?: AbortSignal;
  /** Fallback: a record older than this counts as abandoned. */
  staleAfterMs?: number;
  /** Fallback: how often the holder refreshes its record. */
  heartbeatMs?: number;
  /** Fallback: how often a waiter re-checks the record. */
  pollMs?: number;
};

type ChannelLike = {
  postMessage: (message: unknown) => void;
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  close: () => void;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What the lock needs from the browser. Tests pass one per simulated tab. */
export type CrossTabLockEnv = {
  locks: () => LockManager | null;
  storage: () => StorageLike | null;
  createChannel: (name: string) => ChannelLike | null;
  tabId: string;
  now: () => number;
  addPageHideListener: (listener: () => void) => () => void;
};

type LockRecord = { owner: string; heartbeatAt: number };

/** Long enough to survive Chrome's once-a-minute timer budget in hidden tabs. */
export const CROSS_TAB_LOCK_STALE_MS = 90_000;
export const CROSS_TAB_LOCK_HEARTBEAT_MS = 2_000;
export const CROSS_TAB_LOCK_POLL_MS = 500;
/** Wait after writing a record before trusting it, so a racing write wins cleanly. */
const CLAIM_SETTLE_MS = 40;
const STORAGE_PREFIX = "wgw.lock.";
const CHANNEL_PREFIX = "wgw-lock:";

export function crossTabLockStorageKey(name: string): string {
  return `${STORAGE_PREFIX}${name}`;
}

function randomId(): string {
  return `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(abortReason(signal!));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The lock request was aborted.", "AbortError");
}

export function browserCrossTabLockEnv(): CrossTabLockEnv {
  return {
    locks: () => {
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      return locks && typeof locks.request === "function" ? locks : null;
    },
    storage: () => {
      try {
        return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
      } catch {
        return null;
      }
    },
    createChannel: (name) => {
      if (typeof BroadcastChannel === "undefined") return null;
      try {
        return new BroadcastChannel(name);
      } catch {
        return null;
      }
    },
    tabId: randomId(),
    now: () => Date.now(),
    addPageHideListener: (listener) => {
      if (typeof window === "undefined") return () => undefined;
      window.addEventListener("pagehide", listener);
      return () => window.removeEventListener("pagehide", listener);
    },
  };
}

export type WithCrossTabLock = <T>(
  name: string,
  task: (context: CrossTabLockContext) => Promise<T>,
  options?: CrossTabLockOptions,
) => Promise<T>;

/** Build a lock bound to one environment (one per tab). */
export function createCrossTabLock(env: CrossTabLockEnv): WithCrossTabLock {
  const inTabTails = new Map<string, Promise<unknown>>();

  /** Same-tab callers of one name run one after another before any cross-tab step. */
  function inTabQueue<T>(name: string, run: () => Promise<T>): Promise<T> {
    const previous = inTabTails.get(name) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    const tail = next.catch(() => undefined);
    inTabTails.set(name, tail);
    void tail.then(() => {
      if (inTabTails.get(name) === tail) inTabTails.delete(name);
    });
    return next;
  }

  return function withCrossTabLock<T>(
    name: string,
    task: (context: CrossTabLockContext) => Promise<T>,
    options: CrossTabLockOptions = {},
  ): Promise<T> {
    const locks = env.locks();
    if (locks) return runInWebLock(locks, name, task, options);
    return inTabQueue(name, () => runInFallbackLock(env, name, task, options));
  };
}

function runInWebLock<T>(
  locks: LockManager,
  name: string,
  task: (context: CrossTabLockContext) => Promise<T>,
  options: CrossTabLockOptions,
): Promise<T> {
  const request: LockOptions = { mode: "exclusive" };
  if (options.signal) request.signal = options.signal;
  const neverLost = new AbortController().signal;
  // DOM typings infer the callback result as T, so a promised T becomes Promise<Promise<T>>.
  return locks.request(name, request, () => task({ signal: neverLost })).then((value) => value);
}

async function runInFallbackLock<T>(
  env: CrossTabLockEnv,
  name: string,
  task: (context: CrossTabLockContext) => Promise<T>,
  options: CrossTabLockOptions,
): Promise<T> {
  const storage = env.storage();
  const lost = new AbortController();
  if (!storage) {
    // No shared record is possible, so this is NOT guarded across tabs: only
    // the in-tab queue holds the task.
    return task({ signal: lost.signal });
  }
  const record = new FallbackRecord(env, storage, name, options);
  await record.acquire(options.signal);
  const stopHeartbeat = record.startHeartbeat(() => lost.abort());
  const removePageHide = env.addPageHideListener(() => {
    // The page is going away: stop the task and the heartbeat before the record is freed.
    stopHeartbeat();
    lost.abort();
    record.release();
  });
  try {
    return await task({ signal: lost.signal });
  } finally {
    stopHeartbeat();
    removePageHide();
    record.release();
  }
}

class FallbackRecord {
  private readonly owner: string;
  private readonly key: string;
  private readonly channelName: string;
  private readonly staleAfterMs: number;
  private readonly heartbeatMs: number;
  private readonly pollMs: number;

  constructor(
    private readonly env: CrossTabLockEnv,
    private readonly storage: StorageLike,
    name: string,
    options: CrossTabLockOptions,
  ) {
    this.owner = `${env.tabId}:${randomId()}`;
    this.key = crossTabLockStorageKey(name);
    this.channelName = `${CHANNEL_PREFIX}${name}`;
    this.staleAfterMs = options.staleAfterMs ?? CROSS_TAB_LOCK_STALE_MS;
    this.heartbeatMs = options.heartbeatMs ?? CROSS_TAB_LOCK_HEARTBEAT_MS;
    this.pollMs = options.pollMs ?? CROSS_TAB_LOCK_POLL_MS;
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw abortReason(signal);
      if (this.isFree() && (await this.claim(signal))) return;
      await this.waitForChange(signal);
    }
  }

  /** Refresh the record while the task runs. Calls `onLost` when another tab took it. */
  startHeartbeat(onLost: () => void): () => void {
    const timer = setInterval(() => {
      const current = this.read();
      if (current?.owner !== this.owner) {
        clearInterval(timer);
        onLost();
        return;
      }
      this.write();
    }, this.heartbeatMs);
    return () => clearInterval(timer);
  }

  release(): void {
    if (this.read()?.owner === this.owner) {
      try {
        this.storage.removeItem(this.key);
      } catch {
        // A record left behind goes stale on its own.
      }
    }
    const channel = this.env.createChannel(this.channelName);
    channel?.postMessage({ type: "released", key: this.key });
    channel?.close();
  }

  private isFree(): boolean {
    const current = this.read();
    if (!current) return true;
    return this.env.now() - current.heartbeatAt > this.staleAfterMs;
  }

  private async claim(signal?: AbortSignal): Promise<boolean> {
    if (!this.write()) return false;
    await sleep(CLAIM_SETTLE_MS, signal);
    return this.read()?.owner === this.owner;
  }

  private waitForChange(signal?: AbortSignal): Promise<void> {
    const channel = this.env.createChannel(this.channelName);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(finish, this.pollMs);
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown } | null;
        if (data?.type === "released") finish();
      };
      const onAbort = () => {
        cleanup();
        reject(abortReason(signal!));
      };
      function cleanup() {
        clearTimeout(timer);
        channel?.removeEventListener("message", onMessage);
        channel?.close();
        signal?.removeEventListener("abort", onAbort);
      }
      function finish() {
        cleanup();
        resolve();
      }
      channel?.addEventListener("message", onMessage);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private read(): LockRecord | null {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<LockRecord>;
      if (typeof parsed.owner !== "string" || typeof parsed.heartbeatAt !== "number") return null;
      return { owner: parsed.owner, heartbeatAt: parsed.heartbeatAt };
    } catch {
      return null;
    }
  }

  private write(): boolean {
    try {
      const record: LockRecord = { owner: this.owner, heartbeatAt: this.env.now() };
      this.storage.setItem(this.key, JSON.stringify(record));
      return true;
    } catch {
      return false;
    }
  }
}

let defaultLock: WithCrossTabLock | null = null;

/** The lock for this tab, built from the browser's globals on first use. */
export function withCrossTabLock<T>(
  name: string,
  task: (context: CrossTabLockContext) => Promise<T>,
  options?: CrossTabLockOptions,
): Promise<T> {
  defaultLock ??= createCrossTabLock(browserCrossTabLockEnv());
  return defaultLock(name, task, options);
}

/** Drop the default lock so the next call reads the globals again. For unit tests only. */
export function resetCrossTabLockForTests(): void {
  defaultLock = null;
}
