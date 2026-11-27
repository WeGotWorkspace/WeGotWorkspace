import * as Y from "yjs";
import { dropColumnRefs } from "../../ycsv-ux/shift";
import { newColId, newRowId, newSheetId } from "./ids";
import { deleteAllOccurrences, keeperIndex, moveIn, resolveOrder } from "./order";
import { bookOf, LOCAL, newSheetMap, partsOf, sheetIds, sheetOrderOf, sheetsOf, type SheetParts } from "./workbook";

/**
 * Grid gestures on one sheet of the workbook (spike 6's `ops.ts`, ported to spike 9's
 * order-array layout). Every gesture is one transaction with origin "local": one undo step,
 * and the per-user UndoManager only undoes this person's own edits.
 *
 * Positions come from the grid (indexes into the resolved order); they are turned into ids
 * inside the transaction, so a gesture never writes by index into Yjs.
 */
export type SheetRef = { doc: Y.Doc; id: string };
export type CellWrite = { rowId: string; colId: string; value: string };

function parts(sheet: SheetRef): SheetParts {
  const map = sheetsOf(sheet.doc).get(sheet.id);
  if (!map) throw new Error(`no sheet ${sheet.id}`);
  return partsOf(map);
}

const rowsNow = (p: SheetParts) => resolveOrder(p.rowOrder.toArray(), p.rowData);
const colsNow = (p: SheetParts) => resolveOrder(p.colOrder.toArray(), p.colData);

/** Writes id-form raw values. Empty string clears (the key is removed: empty cells are omitted). */
export function writeCells(sheet: SheetRef, writes: CellWrite[]): void {
  if (writes.length === 0) return;
  sheet.doc.transact(() => {
    const p = parts(sheet);
    for (const w of writes) {
      const cells = p.rowData.get(w.rowId);
      if (!cells) continue;
      const before = cells.get(w.colId) ?? "";
      if (before === w.value) continue;
      if (w.value === "") cells.delete(w.colId);
      else cells.set(w.colId, w.value);
    }
  }, LOCAL);
}

/** `ids`: callers that need known ids (tests, a replayed import) pass them; else random. */
export function insertRows(sheet: SheetRef, at: number, count: number, ids: string[] = Array.from({ length: count }, () => newRowId())): string[] {
  sheet.doc.transact(() => {
    const p = parts(sheet);
    const order = rowsNow(p);
    const before = order[Math.max(0, at)] ?? null;
    for (const id of ids) p.rowData.set(id, new Y.Map<string>());
    p.rowOrder.insert(keeperIndex(p.rowOrder.toArray(), p.rowData, before), ids);
  }, LOCAL);
  return ids;
}

export function deleteRows(sheet: SheetRef, indexes: number[]): void {
  sheet.doc.transact(() => {
    const p = parts(sheet);
    const order = rowsNow(p);
    const gone = new Set<string>();
    for (const i of indexes) {
      const id = order[i];
      if (id) gone.add(id);
    }
    deleteAllOccurrences(p.rowOrder, gone);
    for (const id of gone) p.rowData.delete(id);
  }, LOCAL);
}

/**
 * Move rows [from, from+count) so they land in front of position `to` (positions before the
 * move, as spike 6's grid computes them). Only the order changes (spike 9): a peer's edit in
 * a moved row is kept.
 */
export function moveRows(sheet: SheetRef, from: number, count: number, to: number): void {
  sheet.doc.transact(() => {
    const p = parts(sheet);
    const order = rowsNow(p);
    const ids = order.slice(from, from + count);
    moveIn(p.rowOrder, p.rowData, ids, order[to] ?? null);
  }, LOCAL);
}

function uniqueRef(used: Set<string>, start: number): string {
  let k = start;
  while (used.has(`col${k}`)) k += 1;
  return `col${k}`;
}

export function insertColumns(sheet: SheetRef, at: number, count: number, given: { ids?: string[]; refs?: string[] } = {}): string[] {
  const ids: string[] = [];
  sheet.doc.transact(() => {
    const p = parts(sheet);
    const order = colsNow(p);
    const used = new Set<string>();
    p.colData.forEach((col) => used.add(String(col.get("ref"))));
    const taken = new Set(p.colData.keys());
    for (let k = 0; k < count; k += 1) {
      const colId = given.ids?.[k] ?? newColId(taken);
      taken.add(colId);
      ids.push(colId);
      const ref = given.refs?.[k] ?? uniqueRef(used, order.length + 1 + k);
      used.add(ref);
      const map = new Y.Map<unknown>();
      map.set("ref", ref);
      p.colData.set(colId, map);
    }
    // Rows get no cells for the new columns: a missing cell reads "".
    p.colOrder.insert(keeperIndex(p.colOrder.toArray(), p.colData, order[Math.max(0, at)] ?? null), ids);
  }, LOCAL);
  return ids;
}

export function deleteColumns(sheet: SheetRef, indexes: number[]): void {
  sheet.doc.transact(() => {
    const p = parts(sheet);
    const order = colsNow(p);
    const gone: { colId: string; ref: string }[] = [];
    for (const i of new Set(indexes)) {
      const colId = order[i];
      if (colId) gone.push({ colId, ref: String(p.colData.get(colId)?.get("ref") ?? "") });
    }
    deleteAllOccurrences(p.colOrder, new Set(gone.map((g) => g.colId)));
    for (const g of gone) p.colData.delete(g.colId);
    p.rowData.forEach((cells) => {
      for (const g of gone) cells.delete(g.colId);
      cells.forEach((value, key) => {
        if (value.charCodeAt(0) !== 61) return;
        let next = value;
        for (const g of gone) next = dropColumnRefs(next, g.ref);
        if (next !== value) cells.set(key, next);
      });
    });
  }, LOCAL);
}

/** Move rows by id (a multi-row drag): they land contiguously, in this order, before `beforeId`. */
export function moveRowIds(sheet: SheetRef, ids: string[], beforeId: string | null): void {
  sheet.doc.transact(() => {
    const p = parts(sheet);
    moveIn(p.rowOrder, p.rowData, ids, beforeId);
  }, LOCAL);
}

export function moveColumnIds(sheet: SheetRef, ids: string[], beforeId: string | null): void {
  sheet.doc.transact(() => {
    const p = parts(sheet);
    moveIn(p.colOrder, p.colData, ids, beforeId);
  }, LOCAL);
}

/**
 * Set a column's ref. Known gap: formulas store `ref@rowId` (spike 6 id form), so they are
 * not rewritten here and break on rename. See integration-slice.md.
 */
export function renameColumn(sheet: SheetRef, colId: string, ref: string): void {
  sheet.doc.transact(() => {
    parts(sheet).colData.get(colId)?.set("ref", ref);
  }, LOCAL);
}

export function moveColumns(sheet: SheetRef, from: number, count: number, to: number): void {
  sheet.doc.transact(() => {
    const p = parts(sheet);
    const order = colsNow(p);
    moveIn(p.colOrder, p.colData, order.slice(from, from + count), order[to] ?? null);
  }, LOCAL);
}

export function setColumnWidth(sheet: SheetRef, colId: string, width: number): void {
  sheet.doc.transact(() => {
    parts(sheet).colData.get(colId)?.set("width", Math.round(width));
  }, LOCAL);
}

export function setFrozenRows(sheet: SheetRef, count: number): void {
  sheet.doc.transact(() => parts(sheet).meta.set("frozen_rows", count), LOCAL);
}

// ---------------------------------------------------------------- sort (spike 9)

export function compareCellValues(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  const na = Number(a);
  const nb = Number(b);
  const aNum = a.trim() !== "" && Number.isFinite(na);
  const bNum = b.trim() !== "" && Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : 1;
}

const REF = String.raw`(?:'(?:[^']|'')*'|[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*)`;
const SHEET = String.raw`[A-Za-z0-9_]+`;
const ID = String.raw`[A-Za-z0-9_-]+`;
const RANGE = new RegExp(`(?:(${SHEET})!)?(\\$?${REF})@(\\$?)(${ID}):(?:(${SHEET})!)?(\\$?${REF})@(\\$?)(${ID})`, "g");

/**
 * Sort moves values, not the frame (spike 9): a range whose endpoints were at positions
 * i..j covers i..j again. Integration slice: ranges that point into the sorted sheet from
 * another sheet (`s_x!a@r1:s_x!a@r9`) are rewritten too; ranges of the sorted sheet that
 * point elsewhere are left alone.
 */
export function rewriteRangesForSort(value: string, ownSheet: string, sortedSheet: string, oldIndex: ReadonlyMap<string, number>, newOrder: readonly string[]): string {
  if (!value.startsWith("=") || !value.includes(":")) return value;
  return value.replace(RANGE, (whole, s1: string | undefined, r1: string, d1: string, a: string, s2: string | undefined, r2: string, d2: string, b: string) => {
    const sheetA = s1 ?? ownSheet;
    const sheetB = s2 ?? sheetA;
    if (sheetA !== sortedSheet || sheetB !== sortedSheet) return whole;
    const i = oldIndex.get(a);
    const j = oldIndex.get(b);
    if (i === undefined || j === undefined) return whole;
    const na = newOrder[i];
    const nb = newOrder[j];
    if (na === undefined || nb === undefined) return whole;
    return `${s1 ? `${s1}!` : ""}${r1}@${d1}${na}:${s2 ? `${s2}!` : ""}${r2}@${d2}${nb}`;
  });
}

/** Sort all rows of a sheet by one column's raw value (numbers first, blanks last, stable). */
export function sortRows(sheet: SheetRef, colId: string, descending = false): void {
  sheet.doc.transact(() => {
    const p = parts(sheet);
    const old = rowsNow(p);
    const keyed = old.map((id, index) => ({ id, index, v: p.rowData.get(id)?.get(colId) ?? "" }));
    keyed.sort((x, y) => {
      let c = compareCellValues(x.v, y.v);
      if (descending && x.v !== "" && y.v !== "") c = -c;
      return c !== 0 ? c : x.index - y.index;
    });
    const order = keyed.map((k) => k.id);
    const oldIndex = new Map<string, number>();
    old.forEach((id, i) => oldIndex.set(id, i));
    sheetsOf(sheet.doc).forEach((map, ownId) => {
      partsOf(map).rowData.forEach((cells) => {
        cells.forEach((value, key) => {
          if (value.charCodeAt(0) !== 61) return;
          const next = rewriteRangesForSort(value, ownId, sheet.id, oldIndex, order);
          if (next !== value) cells.set(key, next);
        });
      });
    });
    p.rowOrder.delete(0, p.rowOrder.length);
    p.rowOrder.insert(0, order);
  }, LOCAL);
}

// ---------------------------------------------------------------- sheets

function uniqueSheetRef(doc: Y.Doc, base: string): string {
  const used = new Set<string>();
  sheetsOf(doc).forEach((map) => used.add(String(map.get("ref"))));
  if (!used.has(base)) return base;
  let k = 2;
  while (used.has(`${base}${k}`)) k += 1;
  return `${base}${k}`;
}

/** A new sheet with `cols` empty columns and `rows` empty rows, after `afterId` (null = end). */
export function addSheet(doc: Y.Doc, options: { ref?: string; cols?: number; rows?: number; beforeId?: string | null } = {}): string {
  const id = newSheetId();
  doc.transact(() => {
    const ref = uniqueSheetRef(doc, options.ref ?? `sheet${sheetIds(doc).length + 1}`);
    const map = newSheetMap(ref);
    sheetsOf(doc).set(id, map);
    const p = partsOf(map);
    const taken = new Set<string>();
    const colIds: string[] = [];
    for (let c = 0; c < (options.cols ?? 4); c += 1) {
      const colId = newColId(taken);
      taken.add(colId);
      colIds.push(colId);
      const col = new Y.Map<unknown>();
      col.set("ref", String.fromCharCode(97 + (c % 26)) + (c >= 26 ? String(Math.floor(c / 26)) : ""));
      p.colData.set(colId, col);
    }
    p.colOrder.push(colIds);
    const rowIds = Array.from({ length: options.rows ?? 20 }, () => newRowId());
    for (const rowId of rowIds) p.rowData.set(rowId, new Y.Map<string>());
    p.rowOrder.push(rowIds);
    const order = sheetOrderOf(doc);
    order.insert(keeperIndex(order.toArray(), sheetsOf(doc), options.beforeId ?? null), [id]);
  }, LOCAL);
  return id;
}

/** Rename a sheet's ref (what formulas show). Formulas store the sheet id, so none break. */
export function renameSheet(doc: Y.Doc, sheetId: string, ref: string): void {
  doc.transact(() => sheetsOf(doc).get(sheetId)?.set("ref", ref), LOCAL);
}

export function moveSheet(doc: Y.Doc, sheetId: string, beforeId: string | null): void {
  doc.transact(() => moveIn(sheetOrderOf(doc), sheetsOf(doc), [sheetId], beforeId), LOCAL);
}

/** Delete a sheet. Cross-sheet refs to it read #REF (the formula text keeps the id). */
export function deleteSheet(doc: Y.Doc, sheetId: string): void {
  doc.transact(() => {
    if (sheetIds(doc).length <= 1) return;
    deleteAllOccurrences(sheetOrderOf(doc), new Set([sheetId]));
    sheetsOf(doc).delete(sheetId);
  }, LOCAL);
}

export function setBookDefs(doc: Y.Doc, defs: Record<string, unknown>): void {
  doc.transact(() => bookOf(doc).set("defs", defs), LOCAL);
}
