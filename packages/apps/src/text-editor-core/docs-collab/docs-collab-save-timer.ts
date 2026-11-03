import type { MutableRefObject } from "react";
import { computeSaveDelayMs } from "./docs-collab-save-queue";

type SaveTimerRef = MutableRefObject<ReturnType<typeof setTimeout> | null>;

/** When the armed timer was first armed; gone once it fired or was cancelled. */
const firstArmedAt = new WeakMap<SaveTimerRef, number>();

/**
 * Arms the room's save. Each call pushes it back by SAVE_DELAY_MS, but no
 * further than SAVE_MAX_WAIT_MS after the first call since the last save, so
 * the server gets the text while someone keeps typing (#1533). The retry
 * backoff (`nextSaveAttemptAt`) still wins; `flush` saves right away.
 */
export function armSaveTimer(
  timerRef: SaveTimerRef,
  nextSaveAttemptAt: number,
  save: () => void,
  flush = false,
): void {
  const now = Date.now();
  const armed = timerRef.current !== null;
  if (armed) clearTimeout(timerRef.current ?? undefined);
  const startedAt = armed ? (firstArmedAt.get(timerRef) ?? now) : now;
  firstArmedAt.set(timerRef, startedAt);
  const delayMs = flush ? 0 : computeSaveDelayMs(nextSaveAttemptAt, now, undefined, startedAt);
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    firstArmedAt.delete(timerRef);
    save();
  }, delayMs);
}

export function cancelSaveTimer(timerRef: SaveTimerRef): void {
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = null;
  firstArmedAt.delete(timerRef);
}
