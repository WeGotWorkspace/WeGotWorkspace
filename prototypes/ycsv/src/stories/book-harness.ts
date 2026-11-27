import * as Y from "yjs";
import { deleteRows, deleteSheet, docToText, insertRows, partsOf, SheetView, setFrozenRows, sheetCells, sheetIds, sheetsOf, textToDoc, writeCells } from "../sheets-core/model";

/**
 * Integration slice: test hooks the Playwright specs use (`window.__sheet`, `__sheetB`).
 * The old spikes poked at `doc.getArray("rows")`; the workbook layout has no such array,
 * so the specs go through these helpers instead.
 */
export type SheetHandle = {
  doc: Y.Doc;
  /** The whole workbook as YCSV text. */
  serialize: () => string;
  /** File-form cells of the first (or given) sheet. */
  cells: (sheetId?: string) => string[][];
  sheetIds: () => string[];
  widths: (sheetId?: string) => (number | undefined)[];
  frozen: (sheetId?: string) => number;
  /** Write a cell by resolved position (another person typing). */
  setCell: (r: number, c: number, value: string, sheetId?: string) => void;
  deleteSheet: (sheetId: string) => void;
  insertRows: (at: number, count: number, sheetId?: string) => void;
  deleteRow: (r: number, sheetId?: string) => void;
};

declare global {
  interface Window {
    __sheet?: SheetHandle;
    __sheetB?: SheetHandle;
  }
}

export function bookFromText(text: string, frozen?: number): Y.Doc {
  const doc = new Y.Doc();
  textToDoc(text, doc);
  if (frozen) setFrozenRows({ doc, id: sheetIds(doc)[0]! }, frozen);
  return doc;
}

function first(doc: Y.Doc, sheetId?: string): string {
  return sheetId ?? sheetIds(doc)[0]!;
}

export function handleFor(doc: Y.Doc): SheetHandle {
  /** Resolved order (spike 9 read rule), not the raw arrays. */
  const order = (id: string) => {
    const view = new SheetView(doc, id);
    const out = { rows: view.rowIds, cols: view.colIds, p: partsOf(sheetsOf(doc).get(id)!) };
    view.destroy();
    return out;
  };
  return {
    doc,
    serialize: () => docToText(doc),
    cells: (sheetId) => sheetCells(doc, first(doc, sheetId)),
    sheetIds: () => sheetIds(doc),
    widths: (sheetId) => {
      const { cols, p } = order(first(doc, sheetId));
      return cols.map((id) => p.colData.get(id)?.get("width") as number | undefined);
    },
    frozen: (sheetId) => Number(partsOf(sheetsOf(doc).get(first(doc, sheetId))!).meta.get("frozen_rows") ?? 0),
    setCell: (r, c, value, sheetId) => {
      const id = first(doc, sheetId);
      const { rows, cols } = order(id);
      writeCells({ doc, id }, [{ rowId: rows[r % rows.length]!, colId: cols[c]!, value }]);
    },
    deleteSheet: (sheetId) => deleteSheet(doc, sheetId),
    insertRows: (at, count, sheetId) => void insertRows({ doc, id: first(doc, sheetId) }, at, count),
    deleteRow: (r, sheetId) => deleteRows({ doc, id: first(doc, sheetId) }, [r]),
  };
}
