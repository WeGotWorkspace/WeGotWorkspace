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
  // Give up waiting when another holder never lets go; once the lock is held
  // the timer no longer applies, and an abort from the task is the task's own.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.maxWaitMs);
  let acquired = false;
  return (
    locks.request(name, { mode: "exclusive", signal: controller.signal }, () => {
      acquired = true;
      clearTimeout(timer);
      return task();
    }) as Promise<T>
  ).catch((error: unknown) => {
    if (!acquired && controller.signal.aborted) throw new CrossTabLockTimeoutError(name);
    throw error;
  });
}

/** The lock stayed taken longer than the caller would wait. */
export class CrossTabLockTimeoutError extends Error {
  constructor(name: string) {
    super(`Gave up waiting for lock ${name}`);
    this.name = "CrossTabLockTimeoutError";
  }
}

export function isCrossTabLockTimeout(error: unknown): boolean {
  return error instanceof CrossTabLockTimeoutError;
}

/** Like `withCrossTabLock`, but gives up at once (undefined) when another holder has the lock. */
export function withCrossTabLockIfFree<T>(
  name: string,
  task: () => Promise<T>,
): Promise<T | undefined> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== "function") return task();
  return locks.request(name, { mode: "exclusive", ifAvailable: true }, (lock) =>
    lock ? task() : undefined,
  ) as Promise<T | undefined>;
}

/** Hold the lock until the returned release runs (for example while an editor is open). */
export function holdCrossTabLock(name: string): () => void {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== "function") return () => undefined;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void locks.request(name, { mode: "exclusive" }, () => held);
  return release;
}
