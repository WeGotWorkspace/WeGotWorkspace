import * as Y from "yjs";

export type ClockRange = { client: number; clock: number; len: number };

type CandidateRange = { start: number; end: number };

/**
 * Finds the items of a stale local seed: content the local copy built on its
 * own, in an empty document, that the server never received.
 *
 * `localOnly` holds the candidates: per client, the clocks that were in the
 * local copy when it loaded and that the server lacks. A candidate is kept
 * when it was written on top of content the server has: its left or right
 * neighbour at insert time, or its parent, is a server item or another kept
 * item. Text another tab typed but has not
 * saved yet always is (#1722). A seed is built in an empty document, so its
 * items only point at each other. A candidate at the top level of the document
 * (a new comment, a first title) is also kept when the server has nothing in
 * that place it could be a second copy of.
 *
 * Call it after the server update is applied: the top-level check reads the
 * server's content from the doc.
 */
export function findStaleSeedRanges(ydoc: Y.Doc, localOnly: readonly ClockRange[]): ClockRange[] {
  const candidates = new Map<number, CandidateRange>(
    localOnly.map(({ client, clock, len }) => [client, { start: clock, end: clock + len }]),
  );
  const items = candidateItems(ydoc, candidates);
  const isCandidate = (id: Y.ID): boolean => {
    const range = candidates.get(id.client);
    return range !== undefined && id.clock >= range.start && id.clock < range.end;
  };
  const anchored = new Set<Y.Item>();
  const isKeptRef = (id: Y.ID | null): boolean => {
    if (id === null) return false;
    if (!isCandidate(id)) return true;
    const struct: unknown = Y.getItem(ydoc.store, id);
    // A collected struct says nothing about where it was written; keep what points at it.
    return !(struct instanceof Y.Item) || anchored.has(struct);
  };
  const rootHasOtherContent = rootContentCheck(isCandidate);

  const isAnchored = (item: Y.Item): boolean => {
    // The server holds the start of this run; the rest continues it.
    if (item.id.clock < candidates.get(item.id.client)!.start) return true;
    if (isKeptRef(item.origin) || isKeptRef(item.rightOrigin)) return true;
    const parent = item.parent;
    if (!(parent instanceof Y.AbstractType)) return true;
    if (parent._item) return isKeptRef(parent._item.id);
    return !rootHasOtherContent(parent, item.parentSub);
  };

  // Anchoring spreads along references, so repeat until nothing changes.
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (anchored.has(item) || !isAnchored(item)) continue;
      anchored.add(item);
      changed = true;
    }
  }

  return mergeRanges(
    items
      .filter((item) => !anchored.has(item))
      .map((item) => {
        const { start, end } = candidates.get(item.id.client)!;
        const clock = Math.max(item.id.clock, start);
        return {
          client: item.id.client,
          clock,
          len: Math.min(item.id.clock + item.length, end) - clock,
        };
      }),
  );
}

function candidateItems(ydoc: Y.Doc, candidates: Map<number, CandidateRange>): Y.Item[] {
  const items: Y.Item[] = [];
  for (const [client, { start, end }] of candidates) {
    const structs = ydoc.store.clients.get(client) ?? [];
    for (let i = Y.findIndexSS(structs, start); i < structs.length; i += 1) {
      const struct = structs[i]!;
      if (struct.id.clock >= end) break;
      if (struct instanceof Y.Item) items.push(struct);
    }
  }
  return items;
}

/** Whether a top-level type (or one key of a top-level map) holds anything besides candidates. */
function rootContentCheck(
  isCandidate: (id: Y.ID) => boolean,
): (root: Y.AbstractType<unknown>, key: string | null) => boolean {
  const cache = new Map<Y.AbstractType<unknown>, Map<string | null, boolean>>();
  return (root, key) => {
    let byKey = cache.get(root);
    if (!byKey) {
      byKey = new Map();
      cache.set(root, byKey);
    }
    const cached = byKey.get(key);
    if (cached !== undefined) return cached;
    let other = false;
    if (key === null) {
      for (let item = root._start; item && !other; item = item.right) {
        other = !isCandidate(item.id);
      }
    } else {
      for (let item = root._map.get(key) ?? null; item && !other; item = item.left) {
        other = !isCandidate(item.id);
      }
    }
    byKey.set(key, other);
    return other;
  };
}

function mergeRanges(ranges: ClockRange[]): ClockRange[] {
  ranges.sort((a, b) => a.client - b.client || a.clock - b.clock);
  const merged: ClockRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && last.client === range.client && last.clock + last.len >= range.clock) {
      last.len = Math.max(last.len, range.clock + range.len - last.clock);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
