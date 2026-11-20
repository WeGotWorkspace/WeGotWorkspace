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

/**
 * `first`: work the user waits on to open an app offline (Contacts card pages).
 * While it flows, `bulk` work (Docs bodies, Drive content, contact photos)
 * waits for it.
 */
export type BackgroundSyncPriority = "first" | "bulk";

export type BackgroundSyncPacer = {
  /** Resolves when the next background request may start. Rejects on abort. */
  acquire: (signal?: AbortSignal, priority?: BackgroundSyncPriority) => Promise<void>;
  /** The server answered 429: pause every background request. */
  reportRateLimited: (retryAfterMs: number | null) => void;
  /** A request went through: reset the backoff streak. */
  reportSuccess: () => void;
  /** The user clicked or typed: give their request a head start. */
  noteUserActivity: () => void;
};

/** A reserved slot, or how long `first` work holds `bulk` work back. */
export type BackgroundSyncClaim = { slot: number } | { heldUntil: number };

/**
 * Hands out request slots. `claim` reserves the first free slot at or after
 * `at`; the next claim gets one `intervalMs` later. A `first` claim holds
 * `bulk` claims back until one interval after its slot, so the next `first`
 * page gets the next slot; a held `bulk` claim reserves nothing.
 */
export type BackgroundSyncSlots = {
  claim: (
    at: number,
    intervalMs: number,
    priority?: BackgroundSyncPriority,
  ) => Promise<BackgroundSyncClaim>;
};

/** The schedule's shared state: next free slot and the end of a `first` hold. */
type SlotSchedule = { nextSlotAt: number; heldUntil: number };

/**
 * One claim against `schedule` (mutated). A time more than ten intervals
 * ahead is stale (clock change, old setting) and ignored.
 */
function claimSlot(
  schedule: SlotSchedule,
  at: number,
  intervalMs: number,
  priority: BackgroundSyncPriority,
): BackgroundSyncClaim {
  const fresh = (time: number) => (Number.isFinite(time) && time - at < 10 * intervalMs ? time : 0);
  const heldUntil = fresh(schedule.heldUntil);
  if (priority === "bulk" && heldUntil > at) return { heldUntil };
  const slot = Math.max(fresh(schedule.nextSlotAt), at);
  schedule.nextSlotAt = slot + intervalMs;
  if (priority === "first") schedule.heldUntil = slot + 2 * intervalMs;
  return { slot };
}

export function createMemorySlots(): BackgroundSyncSlots {
  const schedule: SlotSchedule = { nextSlotAt: 0, heldUntil: 0 };
  return {
    async claim(at, intervalMs, priority = "bulk") {
      return claimSlot(schedule, at, intervalMs, priority);
    },
  };
}

const SHARED_SLOT_KEY = "wgw.backgroundSync.nextSlotAt";
const SHARED_HOLD_KEY = "wgw.backgroundSync.heldUntil";
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
    async claim(at, intervalMs, priority = "bulk") {
      try {
        return await locks.request(SHARED_SLOT_LOCK, () => {
          const schedule: SlotSchedule = {
            nextSlotAt: Number(localStorage.getItem(SHARED_SLOT_KEY)),
            heldUntil: Number(localStorage.getItem(SHARED_HOLD_KEY)),
          };
          const before = { ...schedule };
          const claim = claimSlot(schedule, at, intervalMs, priority);
          if (schedule.nextSlotAt !== before.nextSlotAt) {
            localStorage.setItem(SHARED_SLOT_KEY, String(schedule.nextSlotAt));
          }
          if (schedule.heldUntil !== before.heldUntil) {
            localStorage.setItem(SHARED_HOLD_KEY, String(schedule.heldUntil));
          }
          return claim;
        });
      } catch {
        return local.claim(at, intervalMs, priority);
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
    async acquire(signal, priority = "bulk") {
      // Backoff and the user's own requests first, then a browser-wide slot.
      while (true) {
        await waitUntilClear(signal);
        const at = now();
        const claim = await slots.claim(at, intervalMs, priority);
        if ("heldUntil" in claim) {
          await sleep(claim.heldUntil - at, signal);
          continue;
        }
        if (claim.slot > at) await sleep(claim.slot - at, signal);
        break;
      }
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
