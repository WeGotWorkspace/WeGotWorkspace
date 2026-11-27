import * as Y from "yjs";
import {
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  moveColumnIds,
  moveRowIds,
  newSheetMap,
  partsOf,
  rawStats,
  renameColumn,
  repairWorkbook,
  resolveOrder,
  sheetOrderOf,
  sheetsOf,
  sortRows,
  undoScope,
  writeCells,
} from "../src/sheets-core/model";
import type { SheetLayout } from "../src/ycsv-layout";

/**
 * Integration slice: spike 9's `SheetLayout` over the real workbook model, so the row-move
 * fuzz and semantics tests run against `sheets-core` ops (one sheet inside the multi-sheet
 * root, plus a second untouched sheet so the root is not trivially single-sheet).
 */
const SHEET = "s_main";
const OTHER = "s_other";
const sheet = (doc: Y.Doc) => ({ doc, id: SHEET });
const parts = (doc: Y.Doc) => partsOf(sheetsOf(doc).get(SHEET)!);
const rows = (doc: Y.Doc) => resolveOrder(parts(doc).rowOrder.toArray(), parts(doc).rowData);
const cols = (doc: Y.Doc) => resolveOrder(parts(doc).colOrder.toArray(), parts(doc).colData);
const at = (order: string[], beforeId: string | null) => (beforeId === null ? order.length : Math.max(0, order.indexOf(beforeId)));

export const workbookLayout: SheetLayout = {
  name: "workbook",
  roots: (doc) => undoScope(doc),
  seed(doc, seedCols, seedRows, origin = "seed") {
    doc.transact(() => {
      for (const [id, ref] of [
        [SHEET, "main"],
        [OTHER, "other"],
      ] as const) {
        const map = newSheetMap(ref);
        sheetsOf(doc).set(id, map);
        if (id === OTHER) continue;
        const p = partsOf(map);
        for (const col of seedCols) {
          const m = new Y.Map<unknown>();
          m.set("ref", col.ref);
          p.colData.set(col.id, m);
        }
        p.colOrder.push(seedCols.map((c) => c.id));
        for (const row of seedRows) {
          const cells = new Y.Map<string>();
          for (const [k, v] of Object.entries(row.cells)) if (v !== "") cells.set(k, v);
          p.rowData.set(row.id, cells);
        }
        p.rowOrder.push(seedRows.map((r) => r.id));
      }
      sheetOrderOf(doc).push([SHEET, OTHER]);
    }, origin);
  },
  rowOrder: rows,
  colOrder: cols,
  colRef: (doc, colId) => parts(doc).colData.get(colId)?.get("ref") as string | undefined,
  cell: (doc, rowId, colId) => parts(doc).rowData.get(rowId)?.get(colId),
  setCell: (doc, rowId, colId, value) => writeCells(sheet(doc), [{ rowId, colId, value }]),
  insertRow: (doc, rowId, beforeId) => void insertRows(sheet(doc), at(rows(doc), beforeId), 1, [rowId]),
  deleteRow: (doc, rowId) => {
    const i = rows(doc).indexOf(rowId);
    if (i >= 0) deleteRows(sheet(doc), [i]);
  },
  moveRows: (doc, rowIds, beforeId) => moveRowIds(sheet(doc), rowIds, beforeId),
  sortRows: (doc, colId, descending) => sortRows(sheet(doc), colId, descending),
  insertCol: (doc, colId, ref, beforeId) => void insertColumns(sheet(doc), at(cols(doc), beforeId), 1, { ids: [colId], refs: [ref] }),
  deleteCol: (doc, colId) => {
    const i = cols(doc).indexOf(colId);
    if (i >= 0) deleteColumns(sheet(doc), [i]);
  },
  moveCol: (doc, colId, beforeId) => moveColumnIds(sheet(doc), [colId], beforeId),
  renameCol: (doc, colId, ref) => renameColumn(sheet(doc), colId, ref),
  repair: (doc) => repairWorkbook(doc),
  stats(doc) {
    const p = parts(doc);
    const r = rawStats(p.rowOrder.toArray(), p.rowData);
    const c = rawStats(p.colOrder.toArray(), p.colData);
    return { duplicateRows: r.duplicates, duplicateCols: c.duplicates, orphanOrderRows: r.orphans, tiedRows: 0, tiedCols: 0 };
  },
};
