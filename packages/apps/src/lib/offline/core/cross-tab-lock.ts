/**
 * Run `task` while holding an exclusive Web Lock shared by every tab of this
 * origin. Outbox rows live in one IndexedDB per account, so two tabs flushing
 * at once would replay the same queued create twice. Without Web Locks the
 * task runs unlocked (in-tab single-flight still applies).
 *
 * Web Locks are not re-entrant: never call this again with the same name from
 * inside `task`, or it waits on itself.
 */
export function withCrossTabLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== "function") return task();
  return locks.request(name, { mode: "exclusive" }, () => task()) as Promise<T>;
}
