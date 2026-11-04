/** A writer sends at most one `check-now` per peer in this window (#1662). */
export const CHECK_NOW_THROTTLE_MS = 2_000;

export type CheckNowThrottleOptions = {
  send: (usernames: string[]) => void;
  windowMs?: number;
  now?: () => number;
  setTimeoutFn?: (callback: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
};

/**
 * Per-peer throttle for `check-now`. The first write nudges a peer at once.
 * More writes inside the window send one more nudge when it ends, so the last
 * write is never left waiting for the event-source retry. Peers are keyed by
 * lower-cased username, so one peer never gets two nudges for one window.
 */
export class CheckNowThrottle {
  readonly #send: (usernames: string[]) => void;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #setTimeout: (callback: () => void, ms: number) => unknown;
  readonly #clearTimeout: (handle: unknown) => void;
  readonly #lastSentAt = new Map<string, number>();
  readonly #pending = new Set<string>();
  #timer: unknown = null;

  constructor(options: CheckNowThrottleOptions) {
    this.#send = options.send;
    this.#windowMs = options.windowMs ?? CHECK_NOW_THROTTLE_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#setTimeout = options.setTimeoutFn ?? ((callback, ms) => setTimeout(callback, ms));
    this.#clearTimeout =
      options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  request(usernames: readonly string[]): void {
    const now = this.#now();
    const due: string[] = [];
    for (const raw of usernames) {
      const username = raw.trim().toLowerCase();
      if (!username || due.includes(username)) continue;
      if (this.#isDue(username, now)) {
        this.#pending.delete(username);
        this.#lastSentAt.set(username, now);
        due.push(username);
      } else {
        this.#pending.add(username);
      }
    }
    if (due.length > 0) this.#send(due);
    this.#schedule(now);
  }

  dispose(): void {
    if (this.#timer !== null) this.#clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending.clear();
    this.#lastSentAt.clear();
  }

  #isDue(username: string, now: number): boolean {
    const last = this.#lastSentAt.get(username);
    return last === undefined || now - last >= this.#windowMs;
  }

  #schedule(now: number): void {
    if (this.#timer !== null || this.#pending.size === 0) return;
    let wait = this.#windowMs;
    for (const username of this.#pending) {
      const last = this.#lastSentAt.get(username) ?? now;
      wait = Math.min(wait, Math.max(0, last + this.#windowMs - now));
    }
    this.#timer = this.#setTimeout(() => {
      this.#timer = null;
      const pending = [...this.#pending];
      this.#pending.clear();
      this.request(pending);
    }, wait);
  }
}
