/**
 * Randomness for traffic spreading (#2288). One place so tests can pin it:
 * `src/jsdom-setup.ts` sets it to 0 (no spread, no shortening).
 */
let source: () => number = Math.random;

/** Replace the random source (0 ≤ value < 1). Tests only. */
export function setTrafficJitterSource(next: (() => number) | null): void {
  source = next ?? Math.random;
}

/** A random delay in [0, maxMs). */
export function randomSpreadMs(maxMs: number): number {
  return Math.floor(source() * maxMs);
}

/** Jitter that only shortens a wait: × 0.5–1. */
export function shortenWithJitter(ms: number): number {
  return Math.round(ms * (1 - source() * 0.5));
}
