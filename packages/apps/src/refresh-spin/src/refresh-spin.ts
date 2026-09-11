/** One full 360° turn; keep in sync with `refresh-spin.css` animation-duration. */
export const REFRESH_SPIN_CYCLE_MS = 1000;

export const REFRESH_SPIN_CLASSNAME = "refresh-spin";

/**
 * Milliseconds to wait from `now` until the spin has completed ≥1 full cycle
 * (and any in-progress cycle after that) relative to `startedAt`.
 */
export function msUntilRefreshSpinComplete(
  startedAt: number,
  now: number,
  cycleMs: number = REFRESH_SPIN_CYCLE_MS,
): number {
  if (cycleMs <= 0) return 0;
  const elapsed = Math.max(0, now - startedAt);
  const cycles = Math.max(1, Math.ceil(elapsed / cycleMs));
  return Math.max(0, startedAt + cycles * cycleMs - now);
}
