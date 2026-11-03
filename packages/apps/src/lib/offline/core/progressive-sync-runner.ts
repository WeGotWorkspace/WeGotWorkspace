import {
  isRateLimitedError,
  retryAfterMsFromError,
  type BackgroundSyncPacer,
} from "@/lib/offline/core/background-sync-pacer";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";

export type ProgressiveSyncProgress = {
  running: boolean;
  total: number;
  synced: number;
  failed: number;
  updatedAt: number;
};

export function emptyProgressiveSyncProgress(): ProgressiveSyncProgress {
  return {
    running: false,
    total: 0,
    synced: 0,
    failed: 0,
    updatedAt: Date.now(),
  };
}

export async function readProgressiveSyncProgress(
  username: string,
  metaKey: string,
): Promise<ProgressiveSyncProgress> {
  const raw = await readMeta(username, metaKey);
  if (!raw) return emptyProgressiveSyncProgress();
  try {
    return {
      ...emptyProgressiveSyncProgress(),
      ...(JSON.parse(raw) as Partial<ProgressiveSyncProgress>),
      updatedAt: Date.now(),
    };
  } catch {
    return emptyProgressiveSyncProgress();
  }
}

async function writeProgressiveSyncProgress(
  username: string,
  metaKey: string,
  progress: ProgressiveSyncProgress,
): Promise<void> {
  await writeMeta(username, metaKey, JSON.stringify(progress));
}

export type RunProgressiveSyncOptions<T> = {
  username: string;
  metaKey: string;
  items: readonly T[];
  syncOne: (item: T) => Promise<void>;
  concurrency?: number;
  signal?: AbortSignal;
  /**
   * Told about 429s so every paced request backs off. A rate-limited item is
   * retried (up to {@link MAX_RATE_LIMITED_ATTEMPTS}) instead of counted failed.
   */
  pacer?: Pick<BackgroundSyncPacer, "reportRateLimited" | "reportSuccess">;
};

/** Attempts per item while the server keeps answering 429. */
export const MAX_RATE_LIMITED_ATTEMPTS = 5;

/** Progressive bounded-concurrency sync with Dexie meta progress tracking. */
export async function runProgressiveSync<T>({
  username,
  metaKey,
  items,
  syncOne,
  concurrency = 4,
  signal,
  pacer,
}: RunProgressiveSyncOptions<T>): Promise<ProgressiveSyncProgress> {
  const progress: ProgressiveSyncProgress = {
    running: true,
    total: items.length,
    synced: 0,
    failed: 0,
    updatedAt: Date.now(),
  };
  await writeProgressiveSyncProgress(username, metaKey, progress);

  let cursor = 0;
  const next = (): T | undefined => {
    const item = items[cursor];
    cursor += 1;
    return item;
  };

  const syncWithBackoff = async (item: T): Promise<boolean> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await syncOne(item);
        pacer?.reportSuccess();
        return true;
      } catch (error) {
        if (!pacer || !isRateLimitedError(error)) return false;
        pacer.reportRateLimited(retryAfterMsFromError(error));
        if (attempt >= MAX_RATE_LIMITED_ATTEMPTS || signal?.aborted) return false;
      }
    }
  };

  const worker = async () => {
    while (true) {
      if (signal?.aborted) return;
      const item = next();
      if (item === undefined) return;
      if (await syncWithBackoff(item)) progress.synced += 1;
      else if (signal?.aborted) return;
      else progress.failed += 1;
      progress.updatedAt = Date.now();
      await writeProgressiveSyncProgress(username, metaKey, progress);
    }
  };

  const workers = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  progress.running = false;
  progress.updatedAt = Date.now();
  await writeProgressiveSyncProgress(username, metaKey, progress);
  return progress;
}
