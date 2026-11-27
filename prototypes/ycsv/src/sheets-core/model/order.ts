import type * as Y from "yjs";

/**
 * Spike 9's order-array rules, shared by rows, columns and (integration slice) sheets.
 *
 * The order lives in a `Y.Array<id>`, the data in a `Y.Map<id, …>`. A move deletes the id
 * from the order and inserts it elsewhere; data is never copied, so a concurrent edit in a
 * moved row cannot be lost. Read rule (a pure function of the converged state):
 *   1. the first occurrence of an id wins, later ones are ignored;
 *   2. ids without data are ignored (delete wins over move);
 *   3. data without an order entry is appended at the end, sorted by id.
 * `cleanup()` writes that back (e.g. on save); peers doing it at once delete the same items.
 */
export type Keyed = { has(id: string): boolean; readonly size: number; keys(): IterableIterator<string> };

export function resolveOrder(raw: readonly string[], data: Keyed): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (seen.has(id) || !data.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (out.length < data.size) {
    const orphans: string[] = [];
    for (const id of data.keys()) if (!seen.has(id)) orphans.push(id);
    orphans.sort();
    out.push(...orphans);
  }
  return out;
}

/** Raw index of the occurrence that wins for `id` (first one with data), or the end. */
export function keeperIndex(raw: readonly string[], data: Keyed, id: string | null): number {
  if (id === null || !data.has(id)) return raw.length;
  const index = raw.indexOf(id);
  return index < 0 ? raw.length : index;
}

export function deleteAllOccurrences(order: Y.Array<string>, ids: ReadonlySet<string>): void {
  const raw = order.toArray();
  // Delete runs from the end so indexes stay valid; adjacent ids go in one delete.
  let i = raw.length - 1;
  while (i >= 0) {
    if (!ids.has(raw[i] as string)) {
      i -= 1;
      continue;
    }
    let j = i;
    while (j - 1 >= 0 && ids.has(raw[j - 1] as string)) j -= 1;
    order.delete(j, i - j + 1);
    i = j - 1;
  }
}

/** Move `ids` (in this order, contiguous) in front of `beforeId` (null = end). */
export function moveIn(order: Y.Array<string>, data: Keyed, ids: string[], beforeId: string | null): void {
  const moving = new Set(ids.filter((id) => data.has(id)));
  if (moving.size === 0) return;
  deleteAllOccurrences(order, moving);
  const before = beforeId !== null && moving.has(beforeId) ? null : beforeId;
  order.insert(keeperIndex(order.toArray(), data, before), ids.filter((id) => moving.has(id)));
}

export function cleanup(order: Y.Array<string>, data: Keyed): number {
  const raw = order.toArray();
  const seen = new Set<string>();
  const drop: number[] = [];
  raw.forEach((id, index) => {
    if (seen.has(id) || !data.has(id)) drop.push(index);
    else seen.add(id);
  });
  for (let i = drop.length - 1; i >= 0; i -= 1) order.delete(drop[i] as number, 1);
  return drop.length;
}

export function rawStats(raw: readonly string[], data: Keyed): { duplicates: number; orphans: number } {
  const seen = new Set<string>();
  let duplicates = 0;
  let orphans = 0;
  for (const id of raw) {
    if (!data.has(id)) orphans += 1;
    else if (seen.has(id)) duplicates += 1;
    else seen.add(id);
  }
  return { duplicates, orphans };
}
