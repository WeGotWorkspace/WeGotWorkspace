/** Default upper bound for one offline-cache step before callers move on without it. */
export const OFFLINE_CACHE_TIMEOUT_MS = 3000;

/**
 * Settle an IndexedDB cache step with `fallback` when it rejects or stalls.
 *
 * A blocked Dexie open (e.g. a schema upgrade waiting on another tab) never
 * settles, so UI loading state must not wait on the cache unbounded.
 */
export function guardOfflineCacheStep<T>(
  step: Promise<T>,
  fallback: T,
  timeoutMs: number = OFFLINE_CACHE_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    step.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
