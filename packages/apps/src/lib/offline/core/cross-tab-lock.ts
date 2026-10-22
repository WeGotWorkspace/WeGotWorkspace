/**
 * Run `task` while holding an exclusive Web Lock shared by every tab of this
 * origin. Outbox rows live in one IndexedDB per account, so two tabs flushing
 * at once would replay the same queued create twice. Without Web Locks the
 * task runs unlocked (in-tab single-flight still applies).
 *
 * Web Locks are not re-entrant: never call this again with the same name from
 * inside `task`, or it waits on itself.
 *
 * Needs Web Locks and BroadcastChannel (Safari 15.4+, all current Chromium
 * and Firefox); the old localStorage fallback for cross-tab messages is gone.
 */
export function withCrossTabLock<T>(
  name: string,
  task: () => Promise<T>,
  options?: { maxWaitMs?: number },
): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== "function") return task();
  if (options?.maxWaitMs === undefined) {
    return locks.request(name, { mode: "exclusive" }, () => task()) as Promise<T>;
  }
  // Give up waiting (AbortError) when another holder never lets go; once
  // the lock is held, the timer no longer applies.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.maxWaitMs);
  return locks.request(name, { mode: "exclusive", signal: controller.signal }, () => {
    clearTimeout(timer);
    return task();
  }) as Promise<T>;
}

export function isCrossTabLockTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
