/**
 * Paces background sync requests (Drive content, Docs bodies) so they never
 * use up the request budget. Drive and Docs sync share one pacer per tab, and
 * every tab draws its turns from one browser-wide schedule (a Web Lock around a
 * shared next-slot time), so five open apps download no faster than one.
 *
 * - A fixed request rate for the whole browser, well under the host's per-IP limit.
 * - On 429 every background request pauses: `Retry-After` when the server
 *   sends it, otherwise an exponential backoff.
 * - A click or key press pauses background requests briefly, so the user's own
 *   request does not queue behind them.
 */

/**
 * One every 3 s for the whole browser. The app's own account budget (600/min)
 * is not the limit that matters on shared hosting: the host's firewall counts
 * every tab and device behind one IP and may block well before that.
 */
export const BACKGROUND_SYNC_REQUESTS_PER_MINUTE = 20;
/** Pause after a click or key press before background requests resume. */
export const BACKGROUND_SYNC_USER_IDLE_MS = 1500;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

const RATE_LIMITED_STATUS = 429;

/** A background request the server refused with 429. */
export class BackgroundSyncRateLimitedError extends Error {
  readonly status = RATE_LIMITED_STATUS;
  readonly retryAfterMs: number | null;

  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.name = "BackgroundSyncRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** `Retry-After` as delay-seconds or an HTTP date, in ms. `null` when absent or invalid. */
export function parseRetryAfterMs(
  header: string | null | undefined,
  now = Date.now(),
): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

export function isRateLimitedError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  return (error as { status?: unknown }).status === RATE_LIMITED_STATUS;
}

export function retryAfterMsFromError(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("retryAfterMs" in error)) return null;
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export type BackgroundSyncPacer = {
  /** Resolves when the next background request may start. Rejects on abort. */
  acquire: (signal?: AbortSignal) => Promise<void>;
  /** The server answered 429: pause every background request. */
  reportRateLimited: (retryAfterMs: number | null) => void;
  /** A request went through: reset the backoff streak. */
  reportSuccess: () => void;
  /** The user clicked or typed: give their request a head start. */
  noteUserActivity: () => void;
};

/**
 * Hands out request slots. `claim` reserves the first free slot at or after
 * `at` and returns its time; the next claim gets one `intervalMs` later.
 * It returns `null`, reserving nothing, when the queue already runs
 * `SLOT_HORIZON_INTERVALS` intervals ahead: the caller waits and claims again.
 */
export type BackgroundSyncSlots = {
  claim: (at: number, intervalMs: number) => Promise<number | null>;
};

/** How many intervals ahead the shared queue may be reserved. */
const SLOT_HORIZON_INTERVALS = 10;

export function createMemorySlots(): BackgroundSyncSlots {
  let nextSlotAt = 0;
  return {
    async claim(at, intervalMs) {
      const slot = Math.max(nextSlotAt, at);
      nextSlotAt = slot + intervalMs;
      return slot;
    },
  };
}

const SHARED_SLOT_KEY = "wgw.backgroundSync.nextSlotAt";
const SHARED_SLOT_LOCK = "wgw.backgroundSync.slot";

/**
 * Slots shared by every tab of this browser: the next free time lives in
 * localStorage, and a Web Lock makes read-and-reserve atomic across tabs.
 * Falls back to this tab's own schedule without Web Locks or storage.
 */
export function createBrowserSlots(): BackgroundSyncSlots {
  const local = createMemorySlots();
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof localStorage === "undefined") return local;
  return {
    async claim(at, intervalMs) {
      try {
        return await locks.request(SHARED_SLOT_LOCK, () => {
          const stored = Number(localStorage.getItem(SHARED_SLOT_KEY));
          const ahead = stored - at;
          // A live queue never runs past the horizon plus one interval, because
          // a claim past the horizon reserves nothing. Anything further ahead is
          // stale (clock change, old setting): ignore it.
          const live =
            Number.isFinite(stored) && ahead <= (SLOT_HORIZON_INTERVALS + 1) * intervalMs;
          if (live && ahead >= SLOT_HORIZON_INTERVALS * intervalMs) return null;
          const slot = Math.max(live ? stored : 0, at);
          localStorage.setItem(SHARED_SLOT_KEY, String(slot + intervalMs));
          return slot;
        });
      } catch {
        return local.claim(at, intervalMs);
      }
    },
  };
}

export type BackgroundSyncPacerOptions = {
  requestsPerMinute?: number;
  slots?: BackgroundSyncSlots;
  userIdleMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

function abortError(): DOMException {
  return new DOMException("Background sync aborted", "AbortError");
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createBackgroundSyncPacer({
  requestsPerMinute = BACKGROUND_SYNC_REQUESTS_PER_MINUTE,
  userIdleMs = BACKGROUND_SYNC_USER_IDLE_MS,
  now = Date.now,
  sleep = defaultSleep,
  slots = createMemorySlots(),
}: BackgroundSyncPacerOptions = {}): BackgroundSyncPacer {
  const intervalMs = 60_000 / requestsPerMinute;
  let backoffUntil = 0;
  let backoffStreak = 0;
  let userActiveAt = Number.NEGATIVE_INFINITY;

  async function waitUntilClear(signal?: AbortSignal): Promise<void> {
    while (true) {
      if (signal?.aborted) throw abortError();
      const at = now();
      const readyAt = Math.max(backoffUntil, userActiveAt + userIdleMs);
      if (readyAt <= at) return;
      await sleep(readyAt - at, signal);
    }
  }

  return {
    async acquire(signal) {
      // Backoff and the user's own requests first, then a browser-wide slot.
      await waitUntilClear(signal);
      let at = now();
      let slot = await slots.claim(at, intervalMs);
      while (slot === null) {
        // The shared queue is full: wait one interval, then claim again.
        await sleep(intervalMs, signal);
        await waitUntilClear(signal);
        at = now();
        slot = await slots.claim(at, intervalMs);
      }
      if (slot > at) await sleep(slot - at, signal);
      // The user clicked, or the server said 429, while this request waited for
      // its slot: they still go first. The slot is spent; no second claim.
      await waitUntilClear(signal);
    },
    reportRateLimited(retryAfterMs) {
      const delay = retryAfterMs ?? Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** backoffStreak);
      backoffStreak += 1;
      backoffUntil = Math.max(backoffUntil, now() + delay);
    },
    reportSuccess() {
      backoffStreak = 0;
    },
    noteUserActivity() {
      userActiveAt = now();
    },
  };
}

let sharedPacer: BackgroundSyncPacer | null = null;

/**
 * The tab's pacer, drawing slots from the browser-wide schedule. The first
 * call starts listening for clicks and key presses.
 */
export function backgroundSyncPacer(): BackgroundSyncPacer {
  if (sharedPacer) return sharedPacer;
  const pacer = createBackgroundSyncPacer({ slots: createBrowserSlots() });
  sharedPacer = pacer;
  if (typeof window !== "undefined") {
    const onActivity = () => pacer.noteUserActivity();
    const options = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onActivity, options);
    window.addEventListener("keydown", onActivity, options);
  }
  return pacer;
}
