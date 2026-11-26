import * as Y from "yjs";
import { newColId, newRowId } from "../ycsv-model/ids";
import { dropColumnRefs } from "./shift";

/**
 * Grid edits on the YCSV Y.Doc. Every edit is one transaction with origin "local",
 * so one user gesture is one undo step and Y.UndoManager only undoes this user's
 * own edits.
 */
export const LOCAL = "local";

type YRow = Y.Map<unknown>;
type YCol = Y.Map<unknown>;

const rowsOf = (doc: Y.Doc) => doc.getArray<YRow>("rows");
const colsOf = (doc: Y.Doc) => doc.getArray<YCol>("columns");

export type CellWrite = { rowId: string; colId: string; value: string };

function rowMapIndex(doc: Y.Doc): Map<string, YRow> {
  const index = new Map<string, YRow>();
  rowsOf(doc).forEach((row) => index.set(String(row.get("rowId")), row));
  return index;
}

/** Writes id-form raw values. Empty string clears. */
export function writeCells(doc: Y.Doc, writes: CellWrite[]): void {
  if (writes.length === 0) return;
  doc.transact(() => {
    const index = rowMapIndex(doc);
    for (const w of writes) {
      const row = index.get(w.rowId);
      const cells = row?.get("cells") as Y.Map<string> | undefined;
      if (!cells) continue;
      if ((cells.get(w.colId) ?? "") !== w.value) cells.set(w.colId, w.value);
    }
  }, LOCAL);
}

function makeRow(doc: Y.Doc, rowId = newRowId(), values?: Record<string, string>): YRow {
  const cells = new Y.Map<string>();
  colsOf(doc).forEach((col) => {
    const colId = String(col.get("colId"));
    cells.set(colId, values?.[colId] ?? "");
  });
  const row = new Y.Map<unknown>();
  row.set("rowId", rowId);
  row.set("cells", cells);
  return row;
}

export function insertRows(doc: Y.Doc, at: number, count: number): string[] {
  const ids: string[] = [];
  doc.transact(() => {
    const rows = rowsOf(doc);
    const made = Array.from({ length: count }, () => {
      const id = newRowId();
      ids.push(id);
      return makeRow(doc, id);
    });
    rows.insert(Math.max(0, Math.min(rows.length, at)), made);
  }, LOCAL);
  return ids;
}

export function deleteRows(doc: Y.Doc, indexes: number[]): void {
  const sorted = [...new Set(indexes)].sort((a, b) => b - a);
  doc.transact(() => {
    const rows = rowsOf(doc);
    for (const i of sorted) if (i >= 0 && i < rows.length) rows.delete(i, 1);
  }, LOCAL);
}

/**
 * Yjs arrays have no move. A move is delete + insert of a copy with the same row id,
 * so formulas that point at the row keep working. A concurrent edit to a moved row
 * from another user can be lost (it lands on the deleted copy).
 */
export function moveRows(doc: Y.Doc, from: number, count: number, to: number): void {
  doc.transact(() => {
    const rows = rowsOf(doc);
    const copies: { rowId: string; values: Record<string, string> }[] = [];
    for (let i = from; i < from + count; i += 1) {
      const row = rows.get(i);
      const cells = row.get("cells") as Y.Map<string>;
      copies.push({ rowId: String(row.get("rowId")), values: Object.fromEntries(cells.entries()) });
    }
    rows.delete(from, count);
    const target = to > from ? to - count : to;
    rows.insert(Math.max(0, Math.min(rows.length, target)), copies.map((c) => makeRow(doc, c.rowId, c.values)));
  }, LOCAL);
}

function uniqueRef(doc: Y.Doc): string {
  const used = new Set<string>();
  colsOf(doc).forEach((col) => used.add(String(col.get("ref"))));
  let k = colsOf(doc).length + 1;
  while (used.has(`col${k}`)) k += 1;
  return `col${k}`;
}

export function insertColumns(doc: Y.Doc, at: number, count: number): string[] {
  const ids: string[] = [];
  doc.transact(() => {
    const cols = colsOf(doc);
    const made: YCol[] = [];
    for (let k = 0; k < count; k += 1) {
      const map = new Y.Map<unknown>();
      const colId = newColId();
      ids.push(colId);
      map.set("colId", colId);
      // Unique among existing and the ones made in this call.
      let ref = uniqueRef(doc);
      while (made.some((m) => m.get("ref") === ref)) ref = `${ref}_`;
      map.set("ref", ref);
      map.set("rest", {});
      made.push(map);
    }
    cols.insert(Math.max(0, Math.min(cols.length, at)), made);
    rowsOf(doc).forEach((row) => {
      const cells = row.get("cells") as Y.Map<string>;
      for (const id of ids) cells.set(id, "");
    });
  }, LOCAL);
  return ids;
}

export function deleteColumns(doc: Y.Doc, indexes: number[]): void {
  const sorted = [...new Set(indexes)].sort((a, b) => b - a);
  doc.transact(() => {
    const cols = colsOf(doc);
    const gone: { colId: string; ref: string }[] = [];
    for (const i of sorted) {
      if (i < 0 || i >= cols.length) continue;
      const col = cols.get(i);
      gone.push({ colId: String(col.get("colId")), ref: String(col.get("ref")) });
      cols.delete(i, 1);
    }
    rowsOf(doc).forEach((row) => {
      const cells = row.get("cells") as Y.Map<string>;
      for (const g of gone) cells.delete(g.colId);
      cells.forEach((value, key) => {
        let next = value;
        for (const g of gone) next = dropColumnRefs(next, g.ref);
        if (next !== value) cells.set(key, next);
      });
    });
  }, LOCAL);
}

export function moveColumns(doc: Y.Doc, from: number, count: number, to: number): void {
  doc.transact(() => {
    const cols = colsOf(doc);
    const copies: Record<string, unknown>[] = [];
    for (let i = from; i < from + count; i += 1) copies.push(cols.get(i).toJSON());
    cols.delete(from, count);
    const target = to > from ? to - count : to;
    cols.insert(
      Math.max(0, Math.min(cols.length, target)),
      copies.map((json) => {
        const map = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(json)) map.set(k, v);
        return map;
      }),
    );
  }, LOCAL);
}

export function setColumnWidth(doc: Y.Doc, colId: string, width: number): void {
  doc.transact(() => {
    colsOf(doc).forEach((col) => {
      if (col.get("colId") === colId) col.set("width", Math.round(width));
    });
  }, LOCAL);
}

export function setFrozenRows(doc: Y.Doc, count: number): void {
  doc.transact(() => doc.getMap("meta").set("frozen_rows", count), LOCAL);
}

export function makeUndoManager(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager([rowsOf(doc), colsOf(doc), doc.getMap("meta")], {
    trackedOrigins: new Set([LOCAL]),
    captureTimeout: 0,
  });
}
