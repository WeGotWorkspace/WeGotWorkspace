import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { Rng } from "./types";

/**
 * Position keys (fractional indexing, base 62, compared with plain `<`).
 * Uses the `fractional-indexing` package (rocicorp, CC0): appends at the end
 * grow the integer part logarithmically; inserts between two keys add about
 * one bit per insert into the same gap.
 */
export const cmpKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Order by key, ties by id: deterministic on every peer. */
export function cmpPos(ka: string, ia: string, kb: string, ib: string): number {
  return ka < kb ? -1 : ka > kb ? 1 : ia < ib ? -1 : ia > ib ? 1 : 0;
}

export const seedKeys = (n: number): string[] => generateNKeysBetween(null, null, n);

/** How many random halvings a multi-row block takes before its keys are placed. */
export const BLOCK_JITTER_STEPS = 16;

/**
 * Keys for `n` items between `lo` and `hi` (exclusive; null = open end).
 *
 * One item: the plain midpoint, no jitter. Two concurrent single inserts into
 * the same gap then get the same key and are ordered by id; the next insert
 * between them re-keys the tie (see frac-map `ensureGap`).
 *
 * A block (multi-row drag/paste): first a random sub-interval of the gap
 * (BLOCK_JITTER_STEPS halvings), then n keys inside it. Two people dropping a
 * block into the same gap at the same time land in disjoint sub-intervals with
 * probability 1 - 2^-16, so each block stays contiguous instead of the rows
 * interleaving (which identical deterministic keys + id tie-break would do).
 */
export function keysBetween(lo: string | null, hi: string | null, n: number, rng: Rng): string[] {
  if (n <= 0) return [];
  if (n === 1) return [generateKeyBetween(lo, hi)];
  let a = lo;
  let b = hi;
  for (let step = 0; step < BLOCK_JITTER_STEPS; step += 1) {
    const mid = generateKeyBetween(a, b);
    if (rng() < 0.5) b = mid;
    else a = mid;
  }
  return generateNKeysBetween(a, b, n);
}
