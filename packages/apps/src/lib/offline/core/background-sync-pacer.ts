/**
 * Paces background sync requests (Drive content, Docs bodies) so they never
 * use up the account's request budget (600/min, shared by every tab and
 * device). One pacer per tab: Drive and Docs sync share it.
 *
 * - A fixed request rate, well under the account budget.
 * - On 429 every background request pauses: `Retry-After` when the server
 *   sends it, otherwise an exponential backoff.
 * - A click or key press pauses background requests briefly, so the user's own
 *   request does not queue behind them.
 */

/** 2 per second. The account budget is 600/min for all tabs and devices together. */
export const BACKGROUND_SYNC_REQUESTS_PER_MINUTE = 120;
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

export type BackgroundSyncPacerOptions = {
  requestsPerMinute?: number;
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
}: BackgroundSyncPacerOptions = {}): BackgroundSyncPacer {
  const intervalMs = 60_000 / requestsPerMinute;
  let nextSlotAt = 0;
  let backoffUntil = 0;
  let backoffStreak = 0;
  let userActiveAt = Number.NEGATIVE_INFINITY;

  return {
    async acquire(signal) {
      while (true) {
        if (signal?.aborted) throw abortError();
        const at = now();
        const readyAt = Math.max(nextSlotAt, backoffUntil, userActiveAt + userIdleMs);
        if (readyAt <= at) {
          nextSlotAt = at + intervalMs;
          return;
        }
        await sleep(readyAt - at, signal);
      }
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

/** The tab's pacer. The first call starts listening for clicks and key presses. */
export function backgroundSyncPacer(): BackgroundSyncPacer {
  if (sharedPacer) return sharedPacer;
  const pacer = createBackgroundSyncPacer();
  sharedPacer = pacer;
  if (typeof window !== "undefined") {
    const onActivity = () => pacer.noteUserActivity();
    const options = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onActivity, options);
    window.addEventListener("keydown", onActivity, options);
  }
  return pacer;
}
