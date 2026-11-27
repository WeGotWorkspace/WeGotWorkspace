import * as Y from "yjs";
import { rewriteAllRangesForSort, sortedOrder } from "./common";
import { LOCAL, type LayoutStats, type SeedCol, type SeedRow, type SheetLayout } from "./types";

/**
 * Layout B: a separate order. `rowOrder` = Y.Array<string> of row ids,
 * `rowData` = Y.Map<rowId, Y.Map<colId, value>>; the same for columns
 * (`colOrder`, `colData` = Y.Map<colId, Y.Map{ref}>). A move deletes the id
 * from the order and inserts it elsewhere; cells are never touched.
 *
 * Concurrent moves of one row leave the id twice in the order; a concurrent
 * delete can leave an id whose data is gone. Read-time repair, a pure function
 * of the converged state (so every peer resolves the same):
 *   1. first occurrence of an id wins, later ones are ignored;
 *   2. ids without data are ignored (delete wins over move);
 *   3. data without an order entry (not produced by any op here, kept as a
 *      guard) is appended at the end, sorted by id.
 * `repair()` writes that cleanup back (deleting the ignored entries).
 */
const rowOrderOf = (doc: Y.Doc) => doc.getArray<string>("rowOrder");
const rowDataOf = (doc: Y.Doc) => doc.getMap<Y.Map<string>>("rowData");
const colOrderOf = (doc: Y.Doc) => doc.getArray<string>("colOrder");
const colDataOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("colData");

function resolve(raw: readonly string[], data: { has(id: string): boolean; size: number; keys(): IterableIterator<string> }): string[] {
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
function keeperIndex(raw: readonly string[], data: { has(id: string): boolean; size: number; keys(): IterableIterator<string> }, id: string | null): number {
  if (id === null || !data.has(id)) return raw.length;
  const index = raw.indexOf(id);
  return index < 0 ? raw.length : index;
}

function deleteAllOccurrences(order: Y.Array<string>, ids: ReadonlySet<string>): void {
  const raw = order.toArray();
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (ids.has(raw[i] as string)) order.delete(i, 1);
  }
}

function moveIn(order: Y.Array<string>, data: { has(id: string): boolean; size: number; keys(): IterableIterator<string> }, ids: string[], beforeId: string | null): void {
  const moving = new Set(ids.filter((id) => data.has(id)));
  if (moving.size === 0) return;
  deleteAllOccurrences(order, moving);
  const before = beforeId !== null && moving.has(beforeId) ? null : beforeId;
  order.insert(keeperIndex(order.toArray(), data, before), ids.filter((id) => moving.has(id)));
}

function cleanup(order: Y.Array<string>, data: { has(id: string): boolean; size: number; keys(): IterableIterator<string> }): number {
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

function rawStats(raw: readonly string[], data: { has(id: string): boolean; size: number; keys(): IterableIterator<string> }): { duplicates: number; orphans: number } {
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

export const orderArrayLayout: SheetLayout = {
  name: "order array + rows by id",
  roots: (doc) => [rowOrderOf(doc), rowDataOf(doc), colOrderOf(doc), colDataOf(doc)] as Y.AbstractType<unknown>[],

  seed(doc, cols: SeedCol[], rows: SeedRow[], origin: unknown = LOCAL) {
    doc.transact(() => {
      const colData = colDataOf(doc);
      for (const col of cols) {
        const map = new Y.Map<unknown>();
        map.set("ref", col.ref);
        colData.set(col.id, map);
      }
      colOrderOf(doc).push(cols.map((col) => col.id));
      const rowData = rowDataOf(doc);
      for (const row of rows) {
        const cells = new Y.Map<string>();
        for (const [key, value] of Object.entries(row.cells)) cells.set(key, value);
        rowData.set(row.id, cells);
      }
      rowOrderOf(doc).push(rows.map((row) => row.id));
    }, origin);
  },

  rowOrder: (doc) => resolve(rowOrderOf(doc).toArray(), rowDataOf(doc)),
  colOrder: (doc) => resolve(colOrderOf(doc).toArray(), colDataOf(doc)),
  colRef: (doc, colId) => {
    const map = colDataOf(doc).get(colId);
    return map ? String(map.get("ref") ?? "") : undefined;
  },
  cell: (doc, rowId, colId) => rowDataOf(doc).get(rowId)?.get(colId),

  setCell(doc, rowId, colId, value) {
    doc.transact(() => {
      rowDataOf(doc).get(rowId)?.set(colId, value);
    }, LOCAL);
  },

  insertRow(doc, rowId, beforeId) {
    doc.transact(() => {
      rowDataOf(doc).set(rowId, new Y.Map<string>());
      const order = rowOrderOf(doc);
      order.insert(keeperIndex(order.toArray(), rowDataOf(doc), beforeId), [rowId]);
    }, LOCAL);
  },

  deleteRow(doc, rowId) {
    doc.transact(() => {
      deleteAllOccurrences(rowOrderOf(doc), new Set([rowId]));
      rowDataOf(doc).delete(rowId);
    }, LOCAL);
  },

  moveRows(doc, rowIds, beforeId) {
    doc.transact(() => moveIn(rowOrderOf(doc), rowDataOf(doc), rowIds, beforeId), LOCAL);
  },

  sortRows(doc, colId, descending = false) {
    doc.transact(() => {
      const old = orderArrayLayout.rowOrder(doc);
      const order = sortedOrder(old, (id) => orderArrayLayout.cell(doc, id, colId) ?? "", descending);
      rewriteAllRangesForSort(orderArrayLayout, doc, old, order, (rowId, c, value) =>
        rowDataOf(doc).get(rowId)?.set(c, value),
      );
      const rowOrder = rowOrderOf(doc);
      rowOrder.delete(0, rowOrder.length);
      rowOrder.insert(0, order);
    }, LOCAL);
  },

  insertCol(doc, colId, ref, beforeId) {
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set("ref", ref);
      colDataOf(doc).set(colId, map);
      const order = colOrderOf(doc);
      order.insert(keeperIndex(order.toArray(), colDataOf(doc), beforeId), [colId]);
    }, LOCAL);
  },

  deleteCol(doc, colId) {
    doc.transact(() => {
      deleteAllOccurrences(colOrderOf(doc), new Set([colId]));
      colDataOf(doc).delete(colId);
      rowDataOf(doc).forEach((cells) => cells.delete(colId));
    }, LOCAL);
  },

  moveCol(doc, colId, beforeId) {
    doc.transact(() => moveIn(colOrderOf(doc), colDataOf(doc), [colId], beforeId), LOCAL);
  },

  renameCol(doc, colId, ref) {
    doc.transact(() => {
      colDataOf(doc).get(colId)?.set("ref", ref);
    }, LOCAL);
  },

  repair(doc) {
    let fixes = 0;
    doc.transact(() => {
      fixes += cleanup(rowOrderOf(doc), rowDataOf(doc));
      fixes += cleanup(colOrderOf(doc), colDataOf(doc));
    }, "repair");
    return fixes;
  },

  stats(doc): LayoutStats {
    const rows = rawStats(rowOrderOf(doc).toArray(), rowDataOf(doc));
    const cols = rawStats(colOrderOf(doc).toArray(), colDataOf(doc));
    return {
      duplicateRows: rows.duplicates,
      duplicateCols: cols.duplicates,
      orphanOrderRows: rows.orphans,
      tiedRows: 0,
      tiedCols: 0,
    };
  },
};

/**
 * Undo guard for the order-array layout. Plain Yjs undo of a move restores my
 * old order entry; if a peer moved the row after me, that entry comes first
 * and the row jumps back over the peer's newer move. Before undoing, the grid
 * asks whether the top step's order entries are still alive (following Yjs'
 * `redone` links, so my own undo/redo chain does not count as stale). If one
 * is gone, a peer moved or deleted that row since: drop the step instead of
 * undoing it (Google Sheets also skips steps that no longer apply).
 */
export function topUndoIsStaleMove(doc: Y.Doc, undo: Y.UndoManager): boolean {
  const step = undo.undoStack[undo.undoStack.length - 1];
  if (!step) return false;
  const orders = new Set<unknown>([rowOrderOf(doc), colOrderOf(doc)]);
  let stale = false;
  doc.transact((tr) => {
    Y.iterateDeletedStructs(tr, step.insertions, (struct) => {
      if (!(struct instanceof Y.Item) || !orders.has(struct.parent)) return;
      let item: Y.Item = struct;
      while (item.deleted && item.redone !== null) {
        const next = Y.getItem(doc.store, item.redone);
        if (!(next instanceof Y.Item)) break;
        item = next;
      }
      if (item.deleted) stale = true;
    });
  }, "inspect");
  return stale;
}

/** Undo with the guard: a stale move step is dropped; returns what happened. */
export function guardedUndo(doc: Y.Doc, undo: Y.UndoManager): "undone" | "dropped" | "empty" {
  if (undo.undoStack.length === 0) return "empty";
  if (topUndoIsStaleMove(doc, undo)) {
    undo.undoStack.pop();
    return "dropped";
  }
  undo.undo();
  return "undone";
}
