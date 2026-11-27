import type * as Y from "yjs";
import { serialize } from "../ycsv-core/serialize";
import { layoutToFile, orderArrayLayout as L } from "../ycsv-layout";
import type { CompactableShape } from "./epoch";

/**
 * Spike 10: the Sheets side of compaction, on spike 9's order-array layout.
 *
 * The content a compaction keeps is the *resolved* sheet with its ids: column
 * ids and refs, row ids, cell values. Not the YCSV file text: the file never
 * holds row or column ids (spike 9 §8), so a rebuild from the text would give
 * every row a new id and nothing an offline peer wrote could be mapped back.
 */
export type SheetContent = {
  cols: { id: string; ref: string }[];
  rows: { id: string; cells: Record<string, string> }[];
};

export function snapshotSheet(doc: Y.Doc): SheetContent {
  const colIds = L.colOrder(doc);
  const cols = colIds.map((id) => ({ id, ref: L.colRef(doc, id) ?? "" }));
  const rows = L.rowOrder(doc).map((id) => {
    const cells: Record<string, string> = {};
    for (const colId of colIds) {
      const value = L.cell(doc, id, colId);
      if (value !== undefined && value !== "") cells[colId] = value;
    }
    return { id, cells };
  });
  return { cols, rows };
}

export function sheetText(doc: Y.Doc): string {
  return serialize(layoutToFile(L, doc));
}

/** Positions in `seq` that are not on a longest increasing subsequence: the items that moved. */
function movedIndices(seq: number[]): Set<number> {
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  seq.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((tails[mid] as number) < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? (tailIdx[lo - 1] as number) : -1;
  });
  const keep = new Set<number>();
  let k = tails.length > 0 ? (tailIdx[tails.length - 1] as number) : -1;
  while (k >= 0) {
    keep.add(k);
    k = prev[k] as number;
  }
  const moved = new Set<number>();
  for (let i = 0; i < seq.length; i += 1) if (!keep.has(i)) moved.add(i);
  return moved;
}

/**
 * Write `mine - base` into `target` (which holds `base`, possibly plus newer
 * edits by others) as ordinary local operations by id. Cells: last writer wins
 * per cell, as in a live merge. Order: rows that moved relative to the others
 * are moved in front of their successor in `mine`.
 */
function replaySheet(target: Y.Doc, baseDoc: Y.Doc, mineDoc: Y.Doc): void {
  replaySheetContent(target, snapshotSheet(baseDoc), snapshotSheet(mineDoc));
}

function replaySheetContent(target: Y.Doc, base: SheetContent, mine: SheetContent): void {
  const baseCols = new Map(base.cols.map((c) => [c.id, c]));
  const mineCols = new Map(mine.cols.map((c) => [c.id, c]));
  for (const col of base.cols) if (!mineCols.has(col.id)) L.deleteCol(target, col.id);
  mine.cols.forEach((col, i) => {
    const old = baseCols.get(col.id);
    if (!old) {
      const next = mine.cols.slice(i + 1).find((c) => baseCols.has(c.id))?.id ?? null;
      L.insertCol(target, col.id, col.ref, next);
    } else if (old.ref !== col.ref) L.renameCol(target, col.id, col.ref);
  });
  const baseColPos = new Map(base.cols.map((c, i) => [c.id, i]));
  const commonCols = mine.cols.filter((c) => baseColPos.has(c.id));
  const movedCols = movedIndices(commonCols.map((c) => baseColPos.get(c.id) as number));
  commonCols.forEach((col, i) => {
    if (!movedCols.has(i)) return;
    const idx = mine.cols.findIndex((c) => c.id === col.id);
    L.moveCol(target, col.id, mine.cols[idx + 1]?.id ?? null);
  });

  const baseRows = new Map(base.rows.map((r) => [r.id, r]));
  const mineRows = new Set(mine.rows.map((r) => r.id));
  for (const row of base.rows) if (!mineRows.has(row.id)) L.deleteRow(target, row.id);
  // Moves first, against the rows both sides have; then new rows, each in
  // front of its successor in `mine` (inserted back to front, so a run of new
  // rows keeps its order).
  const baseRowPos = new Map(base.rows.map((r, i) => [r.id, i]));
  const commonRows = mine.rows.filter((r) => baseRowPos.has(r.id));
  const movedRows = movedIndices(commonRows.map((r) => baseRowPos.get(r.id) as number));
  for (let i = commonRows.length - 1; i >= 0; i -= 1) {
    if (!movedRows.has(i)) continue;
    L.moveRows(target, [(commonRows[i] as { id: string }).id], commonRows[i + 1]?.id ?? null);
  }
  for (let i = mine.rows.length - 1; i >= 0; i -= 1) {
    const row = mine.rows[i] as SheetContent["rows"][number];
    if (!baseRows.has(row.id)) L.insertRow(target, row.id, mine.rows[i + 1]?.id ?? null);
  }
  for (const row of mine.rows) {
    const old = baseRows.get(row.id);
    for (const col of mine.cols) {
      const value = row.cells[col.id] ?? "";
      const before = old?.cells[col.id] ?? "";
      if (value !== before) L.setCell(target, row.id, col.id, value);
    }
  }
}

export const sheetShape: CompactableShape<SheetContent> = {
  id: "ycsv-order-array",
  snapshot: snapshotSheet,
  build: (target, content) => L.seed(target, content.cols, content.rows, "compaction"),
  replay: replaySheet,
  equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  text: sheetText,
};
