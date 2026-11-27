import * as Y from "yjs";
import { dedupe, rewriteAllRangesForSort, sortedOrder } from "./common";
import { LOCAL, type LayoutStats, type SeedCol, type SeedRow, type SheetLayout } from "./types";

/**
 * Today's layout (spike 5, `ycsv-model`): `rows` = Y.Array<Y.Map{rowId, cells}>,
 * `columns` = Y.Array<Y.Map{colId, ref}>. Yjs has no array move, so a move is
 * delete + insert of a copy. The copy is a new Y.Map: anything a peer writes
 * into the old one concurrently lands in a deleted type and is gone.
 *
 * Read: raw array order, duplicates included (two concurrent moves of one row
 * leave two copies). `cell()` reads the first copy, like a grid keyed by row id would.
 */
type RowMap = Y.Map<unknown>;

const rowsOf = (doc: Y.Doc) => doc.getArray<RowMap>("rows");
const colsOf = (doc: Y.Doc) => doc.getArray<Y.Map<unknown>>("columns");

/**
 * Row id → first index, rebuilt when the array changes (not on cell edits).
 * A real grid keeps such an index; without it every lookup is a linear scan
 * and the benchmark would measure the scan, not the layout.
 */
const rowIndexes = new WeakMap<Y.Array<RowMap>, { stale: boolean; arr: RowMap[]; first: Map<string, number> }>();
function rowIndex(doc: Y.Doc) {
  const rows = rowsOf(doc);
  let entry = rowIndexes.get(rows);
  if (!entry) {
    const created = { stale: true, arr: [] as RowMap[], first: new Map<string, number>() };
    rows.observe(() => {
      created.stale = true;
    });
    rowIndexes.set(rows, created);
    entry = created;
  }
  if (entry.stale) {
    entry.arr = rows.toArray();
    entry.first = new Map();
    entry.arr.forEach((map, i) => {
      const id = String(map.get("rowId"));
      if (!entry?.first.has(id)) entry?.first.set(id, i);
    });
    entry.stale = false;
  }
  return entry;
}

function findRow(doc: Y.Doc, rowId: string): { map: RowMap; index: number } | null {
  const entry = rowIndex(doc);
  const index = entry.first.get(rowId);
  if (index === undefined) return null;
  return { map: entry.arr[index] as RowMap, index };
}

function findCol(doc: Y.Doc, colId: string): { map: Y.Map<unknown>; index: number } | null {
  const all = colsOf(doc).toArray();
  for (let i = 0; i < all.length; i += 1) {
    const map = all[i] as Y.Map<unknown>;
    if (map.get("colId") === colId) return { map, index: i };
  }
  return null;
}

function rowIndexOf(doc: Y.Doc, rowId: string | null): number {
  if (rowId === null) return rowsOf(doc).length;
  return findRow(doc, rowId)?.index ?? rowsOf(doc).length;
}

function newRow(rowId: string, cells: Record<string, string>): RowMap {
  const cellMap = new Y.Map<string>();
  for (const [key, value] of Object.entries(cells)) cellMap.set(key, value);
  const map = new Y.Map<unknown>();
  map.set("rowId", rowId);
  map.set("cells", cellMap);
  return map;
}

function cellsOf(map: RowMap): Y.Map<string> {
  return map.get("cells") as Y.Map<string>;
}

export const baselineLayout: SheetLayout = {
  name: "baseline (move = delete + insert)",
  roots: (doc) => [rowsOf(doc), colsOf(doc)] as Y.AbstractType<unknown>[],

  seed(doc, cols: SeedCol[], rows: SeedRow[], origin: unknown = LOCAL) {
    doc.transact(() => {
      colsOf(doc).push(
        cols.map((col) => {
          const map = new Y.Map<unknown>();
          map.set("colId", col.id);
          map.set("ref", col.ref);
          return map;
        }),
      );
      rowsOf(doc).push(rows.map((row) => newRow(row.id, row.cells)));
    }, origin);
  },

  rowOrder: (doc) => rowsOf(doc).toArray().map((map) => String(map.get("rowId"))),
  colOrder: (doc) => colsOf(doc).toArray().map((map) => String(map.get("colId"))),
  colRef: (doc, colId) => {
    const found = findCol(doc, colId);
    return found ? String(found.map.get("ref") ?? "") : undefined;
  },
  cell(doc, rowId, colId) {
    const found = findRow(doc, rowId);
    return found ? cellsOf(found.map).get(colId) : undefined;
  },

  setCell(doc, rowId, colId, value) {
    doc.transact(() => {
      const found = findRow(doc, rowId);
      if (found) cellsOf(found.map).set(colId, value);
    }, LOCAL);
  },

  insertRow(doc, rowId, beforeId) {
    doc.transact(() => {
      rowsOf(doc).insert(rowIndexOf(doc, beforeId), [newRow(rowId, {})]);
    }, LOCAL);
  },

  deleteRow(doc, rowId) {
    doc.transact(() => {
      const found = findRow(doc, rowId);
      if (found) rowsOf(doc).delete(found.index, 1);
    }, LOCAL);
  },

  moveRows(doc, rowIds, beforeId) {
    doc.transact(() => {
      const rows = rowsOf(doc);
      const copies: RowMap[] = [];
      const found = [...new Set(rowIds)]
        .map((rowId) => ({ rowId, hit: findRow(doc, rowId) }))
        .filter((item) => item.hit !== null)
        .sort((x, y) => (y.hit?.index ?? 0) - (x.hit?.index ?? 0));
      const byId = new Map<string, RowMap>();
      let target = rowIndexOf(doc, beforeId);
      for (const { rowId, hit } of found) {
        if (!hit) continue;
        byId.set(rowId, newRow(rowId, cellsOf(hit.map).toJSON() as Record<string, string>));
        rows.delete(hit.index, 1);
        if (hit.index < target) target -= 1;
      }
      for (const rowId of new Set(rowIds)) {
        const copy = byId.get(rowId);
        if (copy) copies.push(copy);
      }
      rows.insert(target, copies);
    }, LOCAL);
  },

  sortRows(doc, colId, descending = false) {
    doc.transact(() => {
      const rows = rowsOf(doc);
      const old = baselineLayout.rowOrder(doc);
      const order = sortedOrder(old, (id) => baselineLayout.cell(doc, id, colId) ?? "", descending);
      const byId = new Map<string, Record<string, string>>();
      for (const map of rows.toArray()) {
        const id = String(map.get("rowId"));
        if (!byId.has(id)) byId.set(id, cellsOf(map).toJSON() as Record<string, string>);
      }
      const view = {
        colOrder: () => baselineLayout.colOrder(doc),
        cell: (_d: Y.Doc, rowId: string, c: string) => byId.get(rowId)?.[c],
      };
      rewriteAllRangesForSort(view, doc, old, order, (rowId, c, value) => {
        const cells = byId.get(rowId);
        if (cells) cells[c] = value;
      });
      rows.delete(0, rows.length);
      rows.insert(0, order.map((id) => newRow(id, byId.get(id) ?? {})));
    }, LOCAL);
  },

  insertCol(doc, colId, ref, beforeId) {
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set("colId", colId);
      map.set("ref", ref);
      const index = beforeId === null ? colsOf(doc).length : (findCol(doc, beforeId)?.index ?? colsOf(doc).length);
      colsOf(doc).insert(index, [map]);
    }, LOCAL);
  },

  deleteCol(doc, colId) {
    doc.transact(() => {
      const found = findCol(doc, colId);
      if (found) colsOf(doc).delete(found.index, 1);
      for (const map of rowsOf(doc).toArray()) cellsOf(map).delete(colId);
    }, LOCAL);
  },

  moveCol(doc, colId, beforeId) {
    doc.transact(() => {
      const found = findCol(doc, colId);
      if (!found) return;
      const copy = new Y.Map<unknown>();
      copy.set("colId", colId);
      copy.set("ref", found.map.get("ref"));
      colsOf(doc).delete(found.index, 1);
      const index = beforeId === null ? colsOf(doc).length : (findCol(doc, beforeId)?.index ?? colsOf(doc).length);
      colsOf(doc).insert(index, [copy]);
    }, LOCAL);
  },

  renameCol(doc, colId, ref) {
    doc.transact(() => {
      findCol(doc, colId)?.map.set("ref", ref);
    }, LOCAL);
  },

  stats(doc): LayoutStats {
    return {
      duplicateRows: dedupe(baselineLayout.rowOrder(doc)).dropped,
      duplicateCols: dedupe(baselineLayout.colOrder(doc)).dropped,
      orphanOrderRows: 0,
      tiedRows: 0,
      tiedCols: 0,
    };
  },
};
