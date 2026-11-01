/**
 * Device storage checks before a file is queued. `navigator.storage` only
 * exists in a secure context, and `estimate()` and `persist()` can each be
 * missing on their own (Safari), so every step is optional.
 */

/** Room left for the rest of the app after a queued file. */
export const LOCAL_COPY_HEADROOM_BYTES = 32 * 1024 * 1024;

type StorageManagerLike = {
  estimate?: () => Promise<StorageEstimate>;
  persist?: () => Promise<boolean>;
};

function storageManager(): StorageManagerLike | null {
  if (typeof navigator === "undefined") return null;
  const storage = (navigator as Navigator & { storage?: StorageManagerLike }).storage;
  return storage ?? null;
}

/** Free bytes for this origin, or null when the browser cannot say. */
export async function estimateFreeDeviceBytes(): Promise<number | null> {
  const manager = storageManager();
  if (!manager || typeof manager.estimate !== "function") return null;
  try {
    const { quota, usage } = await manager.estimate();
    if (typeof quota !== "number" || !Number.isFinite(quota)) return null;
    return Math.max(0, quota - (typeof usage === "number" ? usage : 0));
  } catch {
    return null;
  }
}

/**
 * Whether each file (in pick order) gets a local copy. Unknown free space
 * counts as enough: a real quota failure then shows up as a `quota` error.
 */
export async function planLocalCopies(sizes: readonly number[]): Promise<boolean[]> {
  let free = await estimateFreeDeviceBytes();
  if (free === null) return sizes.map(() => true);
  return sizes.map((size) => {
    if (size + LOCAL_COPY_HEADROOM_BYTES > free!) return false;
    free! -= size;
    return true;
  });
}

let persistRequested = false;

/** Ask once per tab to keep this origin's storage from being evicted. */
export async function requestPersistentStorageOnce(): Promise<void> {
  if (persistRequested) return;
  persistRequested = true;
  const manager = storageManager();
  if (!manager || typeof manager.persist !== "function") return;
  try {
    await manager.persist();
  } catch {
    // The browser may refuse; uploads work either way.
  }
}

export function resetPersistentStorageRequestForTests(): void {
  persistRequested = false;
}

/** IndexedDB ran out of room, directly or wrapped by Dexie. */
export function isQuotaExceededError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const name = (current as { name?: unknown }).name;
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
    current = (current as { inner?: unknown }).inner;
  }
  return false;
}
