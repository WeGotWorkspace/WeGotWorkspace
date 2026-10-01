const REFRESH_LOCK_KEY = "wgw.api.refresh.lock";
const REFRESH_CHANNEL = "wgw-auth-refresh";
const WEB_LOCK_NAME = "wgw-auth-refresh";
export const STALE_LOCK_TIMEOUT_MS = 30_000;
const WAIT_POLL_MS = 250;

type RefreshLockRecord = {
  owner: string;
  acquiredAt: number;
};

let inTabRefreshPromise: Promise<boolean> | null = null;
const tabId = `${Math.random().toString(36).slice(2)}-${Date.now()}`;

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function nowMs(): number {
  return Date.now();
}

function createChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(REFRESH_CHANNEL);
  } catch {
    return null;
  }
}

function readLockRecord(): RefreshLockRecord | null {
  if (!hasWindowStorage()) return null;
  try {
    const raw = window.localStorage.getItem(REFRESH_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { owner?: unknown; acquiredAt?: unknown };
    if (typeof parsed.owner !== "string" || typeof parsed.acquiredAt !== "number") return null;
    return { owner: parsed.owner, acquiredAt: parsed.acquiredAt };
  } catch {
    return null;
  }
}

function isStale(record: RefreshLockRecord | null, now = nowMs()): boolean {
  if (!record) return false;
  return now - record.acquiredAt > STALE_LOCK_TIMEOUT_MS;
}

function writeLockRecord(record: RefreshLockRecord): boolean {
  if (!hasWindowStorage()) return false;
  try {
    window.localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function removeLockRecord(): void {
  if (!hasWindowStorage()) return;
  try {
    window.localStorage.removeItem(REFRESH_LOCK_KEY);
  } catch {
    // Ignore localStorage failures.
  }
}

function tryAcquireLock(owner: string): boolean {
  const existing = readLockRecord();
  const now = nowMs();
  if (!existing || isStale(existing, now)) {
    if (!writeLockRecord({ owner, acquiredAt: now })) {
      return false;
    }
    const confirmed = readLockRecord();
    return confirmed?.owner === owner;
  }
  return existing.owner === owner;
}

async function waitForUnlock(owner: string): Promise<void> {
  const channel = createChannel();
  try {
    await new Promise<void>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let interval: ReturnType<typeof setInterval> | null = null;

      const finish = () => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        if (channel) channel.removeEventListener("message", onChannelMessage);
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
        resolve();
      };

      const lockGoneOrStale = () => {
        const record = readLockRecord();
        if (!record || isStale(record)) {
          finish();
        }
      };

      const onChannelMessage = (event: MessageEvent) => {
        const payload = event.data as { type?: unknown; owner?: unknown } | undefined;
        if (!payload || typeof payload.type !== "string") return;
        if (payload.type === "released") {
          finish();
          return;
        }
        if (
          payload.type === "started" &&
          typeof payload.owner === "string" &&
          payload.owner !== owner
        ) {
          lockGoneOrStale();
        }
      };

      const onStorage = (event: StorageEvent) => {
        if (event.key !== REFRESH_LOCK_KEY) return;
        lockGoneOrStale();
      };

      if (channel) channel.addEventListener("message", onChannelMessage);
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

      interval = setInterval(lockGoneOrStale, WAIT_POLL_MS);
      timer = setTimeout(finish, STALE_LOCK_TIMEOUT_MS + 1_000);
      lockGoneOrStale();
    });
  } finally {
    channel?.close();
  }
}

async function withCrossTabLock(task: () => Promise<boolean>): Promise<boolean> {
  const owner = `${tabId}-${Math.random().toString(36).slice(2)}`;
  const channel = createChannel();
  const hasStorage = hasWindowStorage();

  if (!hasStorage) {
    channel?.close();
    return task();
  }

  if (!tryAcquireLock(owner)) {
    await waitForUnlock(owner);
    return false;
  }

  try {
    channel?.postMessage({ type: "started", owner, at: nowMs() });
    return await task();
  } finally {
    const record = readLockRecord();
    if (record?.owner === owner) {
      removeLockRecord();
    }
    channel?.postMessage({ type: "released", owner, at: nowMs() });
    channel?.close();
  }
}

function webLocks(): LockManager | null {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== "function") return null;
  return locks;
}

function runInWebLock(locks: LockManager, task: () => Promise<boolean>): Promise<boolean> {
  // DOM typings infer the callback result as T, so a promised boolean becomes Promise<Promise<boolean>>.
  return locks.request(WEB_LOCK_NAME, { mode: "exclusive" }, () => task()).then((value) => value);
}

/**
 * Coalesce refresh calls in-tab and coordinate lock ownership across tabs.
 * A waiting Web Locks tab runs the task itself after the previous holder releases.
 * The localStorage fallback returns false when another tab held the lock.
 */
export function withAuthRefreshLock(task: () => Promise<boolean>): Promise<boolean> {
  if (inTabRefreshPromise) {
    return inTabRefreshPromise;
  }
  const locks = webLocks();
  const locked = locks ? runInWebLock(locks, task) : withCrossTabLock(task);
  inTabRefreshPromise = locked.finally(() => {
    inTabRefreshPromise = null;
  });
  return inTabRefreshPromise;
}

export function resetAuthRefreshLockForTests(): void {
  inTabRefreshPromise = null;
  removeLockRecord();
}
