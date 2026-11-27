import { generateNKeysBetween } from "fractional-indexing";
import * as Y from "yjs";
import { rewriteAllRangesForSort, sortedOrder } from "./common";
import { cmpPos, keysBetween, seedKeys } from "./frac-keys";
import { LOCAL, type LayoutStats, type Rng, type SeedCol, type SeedRow, type SheetLayout } from "./types";

/**
 * Layout C: rows in a Y.Map keyed by row id, each row a Y.Map
 * `{ p: <position key>, c: Y.Map<colId, value> }`; columns the same in
 * `colsById` (`{ p, ref }`). The order is "sort by (p, id)". A move is one
 * `p` write per moved row: cells are never touched, and since `p` is a single
 * map value, two concurrent moves of one row resolve last-writer-wins (Yjs map
 * semantics, the same winner on every peer). There is no array entry that can
 * be duplicated or orphaned.
 *
 * The resolved order is kept in an `OrderIndex` per doc that follows Yjs
 * events (insert/delete/`p` change → one binary-search splice), so a move or
 * read never re-sorts the sheet.
 */
type RowMap = Y.Map<unknown>;

const rowsOf = (doc: Y.Doc) => doc.getMap<RowMap>("rowsById");
const colsOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("colsById");
/**
 * A row can end up without `p`: per-user undo of a move restores the old key
 * only if nobody overwrote it, so two concurrent moves of one row undone by
 * both movers leave no value (found by the fuzz). Such a row sorts at the end
 * (`~` is above every base-62 digit) by id, on every peer, and the next
 * gap/repair touching it gives it a real key.
 */
export const UNPLACED = "~";
const keyOf = (map: Y.Map<unknown> | undefined): string => {
  const p = map?.get("p");
  return typeof p === "string" && p !== "" ? p : UNPLACED;
};

/** Sorted ids by (p, id), kept in step with the Y.Map through observeDeep. */
class OrderIndex {
  private ids: string[] = [];
  private keys = new Map<string, string>();
  private dirty = true;

  constructor(private readonly map: Y.Map<Y.Map<unknown>>) {
    map.observeDeep((events) => this.apply(events));
  }

  private find(id: string, key: string): number {
    let lo = 0;
    let hi = this.ids.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const other = this.ids[mid] as string;
      if (cmpPos(this.keys.get(other) ?? "", other, key, id) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private remove(id: string): void {
    const key = this.keys.get(id);
    if (key === undefined) return;
    const at = this.find(id, key);
    if (this.ids[at] === id) this.ids.splice(at, 1);
    else this.dirty = true;
    this.keys.delete(id);
  }

  private add(id: string, key: string): void {
    this.keys.set(id, key);
    this.ids.splice(this.find(id, key), 0, id);
  }

  private touch(id: string): void {
    this.remove(id);
    const row = this.map.get(id);
    if (row) this.add(id, keyOf(row));
  }

  private apply(events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
    if (this.dirty) return;
    const changed = new Set<string>();
    for (const event of events) {
      if (event.target === this.map) {
        for (const key of event.changes.keys.keys()) changed.add(key);
      } else if (event.target.parent === this.map && (event as Y.YMapEvent<unknown>).keysChanged.has("p")) {
        const id = (event.target as unknown as { _item: { parentSub: string } })._item.parentSub;
        changed.add(id);
      }
    }
    if (changed.size > 2000) {
      this.dirty = true;
      return;
    }
    for (const id of changed) this.touch(id);
  }

  order(): string[] {
    if (this.dirty) {
      const entries: { id: string; key: string }[] = [];
      this.keys.clear();
      this.map.forEach((row, id) => {
        const key = keyOf(row);
        entries.push({ id, key });
        this.keys.set(id, key);
      });
      entries.sort((a, b) => cmpPos(a.key, a.id, b.key, b.id));
      this.ids = entries.map((entry) => entry.id);
      this.dirty = false;
    }
    return this.ids;
  }
}

const indexes = new WeakMap<Y.Map<Y.Map<unknown>>, OrderIndex>();
function indexOf(map: Y.Map<Y.Map<unknown>>): OrderIndex {
  let index = indexes.get(map);
  if (!index) {
    index = new OrderIndex(map);
    indexes.set(map, index);
  }
  return index;
}

/**
 * Neighbour keys for landing in front of `beforeId`, skipping `moving`. If the
 * two neighbours share a key (a tie from concurrent inserts into one gap), the
 * tied run is re-keyed first so a key between them exists. Re-keying is a
 * plain `p` write: safe under concurrency like any move.
 */
function gap(
  map: Y.Map<Y.Map<unknown>>,
  beforeId: string | null,
  moving: ReadonlySet<string>,
): { lo: string | null; hi: string | null } {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const order = indexOf(map).order().filter((id) => !moving.has(id));
    let at = beforeId === null || moving.has(beforeId) ? order.length : order.indexOf(beforeId);
    if (at < 0) at = order.length;
    const prevId = at > 0 ? order[at - 1] : undefined;
    const nextId = order[at];
    const lo = prevId === undefined ? null : keyOf(map.get(prevId));
    const hi = nextId === undefined ? null : keyOf(map.get(nextId));
    const bad = lo === UNPLACED ? lo : hi === UNPLACED ? hi : lo !== null && hi !== null && lo >= hi ? lo : null;
    if (bad === null) return { lo, hi };
    // Tie or unplaced rows: re-key that run first.
    const run = order.filter((id) => keyOf(map.get(id)) === bad);
    const first = order.indexOf(run[0] as string);
    const below = first > 0 ? keyOf(map.get(order[first - 1] as string)) : null;
    const afterId = order[first + run.length];
    const aboveKey = afterId === undefined ? null : keyOf(map.get(afterId));
    const above = aboveKey === UNPLACED ? null : aboveKey;
    // Deterministic (no jitter): two peers re-keying the same tie write the same keys.
    const keys = generateNKeysBetween(below, above, run.length);
    run.forEach((id, i) => map.get(id)?.set("p", keys[i] as string));
  }
  throw new Error("frac-map: could not open a gap");
}

function placeIn(map: Y.Map<Y.Map<unknown>>, ids: string[], beforeId: string | null, rng: Rng): void {
  const present = ids.filter((id) => map.has(id));
  if (present.length === 0) return;
  const { lo, hi } = gap(map, beforeId, new Set(present));
  const keys = keysBetween(lo, hi, present.length, rng);
  present.forEach((id, i) => map.get(id)?.set("p", keys[i] as string));
}

/** Re-key every tie and every unplaced row (write-back of the read-time rule). */
function repairKeys(map: Y.Map<Y.Map<unknown>>): number {
  const order = indexOf(map).order().slice();
  let fixes = 0;
  let i = 0;
  while (i < order.length) {
    const key = keyOf(map.get(order[i] as string));
    let j = i + 1;
    while (j < order.length && keyOf(map.get(order[j] as string)) === key) j += 1;
    if (j - i > 1 || key === UNPLACED) {
      const below = i > 0 ? keyOf(map.get(order[i - 1] as string)) : null;
      const aboveKey = j < order.length ? keyOf(map.get(order[j] as string)) : null;
      const keys = generateNKeysBetween(below, aboveKey === UNPLACED ? null : aboveKey, j - i);
      for (let k = i; k < j; k += 1) map.get(order[k] as string)?.set("p", keys[k - i] as string);
      fixes += j - i;
    }
    i = j;
  }
  return fixes;
}

function ties(map: Y.Map<Y.Map<unknown>>): number {
  const seen = new Map<string, number>();
  map.forEach((row) => {
    const key = keyOf(row);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  let tied = 0;
  for (const [key, count] of seen) if (count > 1 || key === UNPLACED) tied += count;
  return tied;
}

export function createFracMapLayout(rng: Rng = Math.random): SheetLayout {
  const layout: SheetLayout = {
    name: "fractional key per row (LWW)",
    roots: (doc) => [rowsOf(doc), colsOf(doc)] as Y.AbstractType<unknown>[],

    seed(doc, cols: SeedCol[], rows: SeedRow[], origin: unknown = LOCAL) {
      doc.transact(() => {
        const colKeys = seedKeys(cols.length);
        cols.forEach((col, i) => {
          const map = new Y.Map<unknown>();
          map.set("p", colKeys[i]);
          map.set("ref", col.ref);
          colsOf(doc).set(col.id, map);
        });
        const rowKeys = seedKeys(rows.length);
        const rowMap = rowsOf(doc);
        rows.forEach((row, i) => {
          const cells = new Y.Map<string>();
          for (const [key, value] of Object.entries(row.cells)) cells.set(key, value);
          const map = new Y.Map<unknown>();
          map.set("p", rowKeys[i]);
          map.set("c", cells);
          rowMap.set(row.id, map);
        });
      }, origin);
    },

    rowOrder: (doc) => indexOf(rowsOf(doc)).order().slice(),
    colOrder: (doc) => indexOf(colsOf(doc)).order().slice(),
    colRef: (doc, colId) => {
      const map = colsOf(doc).get(colId);
      return map ? String(map.get("ref") ?? "") : undefined;
    },
    cell: (doc, rowId, colId) => (rowsOf(doc).get(rowId)?.get("c") as Y.Map<string> | undefined)?.get(colId),

    setCell(doc, rowId, colId, value) {
      doc.transact(() => {
        (rowsOf(doc).get(rowId)?.get("c") as Y.Map<string> | undefined)?.set(colId, value);
      }, LOCAL);
    },

    insertRow(doc, rowId, beforeId) {
      doc.transact(() => {
        const map = rowsOf(doc);
        const { lo, hi } = gap(map, beforeId, new Set());
        const row = new Y.Map<unknown>();
        row.set("p", keysBetween(lo, hi, 1, rng)[0]);
        row.set("c", new Y.Map<string>());
        map.set(rowId, row);
      }, LOCAL);
    },

    deleteRow(doc, rowId) {
      doc.transact(() => rowsOf(doc).delete(rowId), LOCAL);
    },

    moveRows(doc, rowIds, beforeId) {
      doc.transact(() => placeIn(rowsOf(doc), rowIds, beforeId, rng), LOCAL);
    },

    sortRows(doc, colId, descending = false) {
      doc.transact(() => {
        const old = layout.rowOrder(doc);
        const order = sortedOrder(old, (id) => layout.cell(doc, id, colId) ?? "", descending);
        rewriteAllRangesForSort(layout, doc, old, order, (rowId, c, value) =>
          (rowsOf(doc).get(rowId)?.get("c") as Y.Map<string> | undefined)?.set(c, value),
        );
        // Fresh evenly spaced keys: the sort doubles as a rebalance of long keys.
        // Every row is written, also when its key happens not to change: two
        // concurrent sorts then conflict on every row and the same peer wins
        // all of them (Yjs map LWW is per client), so one whole sort wins
        // instead of a mix of both (found by the targeted test).
        const keys = seedKeys(order.length);
        const map = rowsOf(doc);
        order.forEach((id, i) => map.get(id)?.set("p", keys[i] as string));
      }, LOCAL);
    },

    insertCol(doc, colId, ref, beforeId) {
      doc.transact(() => {
        const map = colsOf(doc);
        const { lo, hi } = gap(map, beforeId, new Set());
        const col = new Y.Map<unknown>();
        col.set("p", keysBetween(lo, hi, 1, rng)[0]);
        col.set("ref", ref);
        map.set(colId, col);
      }, LOCAL);
    },

    deleteCol(doc, colId) {
      doc.transact(() => {
        colsOf(doc).delete(colId);
        rowsOf(doc).forEach((row) => (row.get("c") as Y.Map<string>).delete(colId));
      }, LOCAL);
    },

    moveCol(doc, colId, beforeId) {
      doc.transact(() => placeIn(colsOf(doc), [colId], beforeId, rng), LOCAL);
    },

    renameCol(doc, colId, ref) {
      doc.transact(() => {
        colsOf(doc).get(colId)?.set("ref", ref);
      }, LOCAL);
    },

    repair(doc) {
      let fixes = 0;
      doc.transact(() => {
        fixes += repairKeys(rowsOf(doc));
        fixes += repairKeys(colsOf(doc));
      }, "repair");
      return fixes;
    },

    stats(doc): LayoutStats {
      return {
        duplicateRows: 0,
        duplicateCols: 0,
        orphanOrderRows: 0,
        tiedRows: ties(rowsOf(doc)),
        tiedCols: ties(colsOf(doc)),
      };
    },
  };
  return layout;
}

/** Longest and mean position key length, for the key-growth measurements. */
export function rowKeyLengths(doc: Y.Doc): { max: number; mean: number } {
  let max = 0;
  let sum = 0;
  let n = 0;
  rowsOf(doc).forEach((row) => {
    const len = keyOf(row).length;
    max = Math.max(max, len);
    sum += len;
    n += 1;
  });
  return { max, mean: n === 0 ? 0 : sum / n };
}
