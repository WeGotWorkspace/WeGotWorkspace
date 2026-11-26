import * as Y from "yjs";
import { newColId, newRowId } from "./ids";
import { toIdForm, type ColInfo } from "./refs";

function columnsOf(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>("columns");
}

function rowsOf(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>("rows");
}

function snapshot(doc: Y.Doc): { cols: ColInfo[]; rowIds: string[] } {
  const columns = columnsOf(doc);
  const rows = rowsOf(doc);
  const cols: ColInfo[] = [];
  for (const map of columns.toArray()) {
    cols.push({ colId: String(map.get("colId") ?? ""), ref: String(map.get("ref") ?? "") });
  }
  const rowIds: string[] = [];
  for (const row of rows.toArray()) rowIds.push(String(row.get("rowId") ?? ""));
  return { cols, rowIds };
}

/** The row order a file-form text was written against (taken when the cell editor opened). */
export type EditBase = { rowIds: string[] };

export function editBase(doc: Y.Doc): EditBase {
  return { rowIds: snapshot(doc).rowIds };
}

/**
 * Set a cell from file-form text. `base`: resolve `aantal3` against the rows
 * as they were when the person started typing, not as they are now. A peer's
 * row insert that lands while the editor is open must not retarget the
 * reference (spike 5 e2e found this).
 */
export function setCell(
  doc: Y.Doc,
  rowId: string,
  colId: string,
  fileFormValue: string,
  base?: EditBase,
): void {
  doc.transact(() => {
    const { cols, rowIds: current } = snapshot(doc);
    const rowIds = base?.rowIds ?? current;
    const idForm = toIdForm(fileFormValue, cols, rowIds);
    for (const row of rowsOf(doc).toArray()) {
      if (row.get("rowId") !== rowId) continue;
      const cells = row.get("cells") as Y.Map<string>;
      cells.set(colId, idForm);
      return;
    }
  }, "local");
}

export function insertRowAfter(doc: Y.Doc, index: number): void {
  doc.transact(() => {
    const columns = columnsOf(doc);
    const rows = rowsOf(doc);
    const cells = new Y.Map<string>();
    for (let i = 0; i < columns.length; i += 1) {
      cells.set(String(columns.get(i).get("colId") ?? ""), "");
    }
    const row = new Y.Map<unknown>();
    row.set("rowId", newRowId());
    row.set("cells", cells);
    const at = Math.max(0, Math.min(rows.length, index + 1));
    rows.insert(at, [row]);
  }, "local");
}

export function deleteRow(doc: Y.Doc, rowId: string): void {
  doc.transact(() => {
    const rows = rowsOf(doc);
    for (let i = 0; i < rows.length; i += 1) {
      if (rows.get(i).get("rowId") === rowId) {
        rows.delete(i, 1);
        return;
      }
    }
  }, "local");
}

/** Insert a column at `index` with `ref`. Existing rows get no cell: a missing cell reads "". */
export function insertColumn(doc: Y.Doc, index: number, ref: string, colId: string = newColId()): string {
  doc.transact(() => {
    const columns = columnsOf(doc);
    const map = new Y.Map<unknown>();
    map.set("colId", colId);
    map.set("ref", ref);
    map.set("rest", {});
    columns.insert(Math.max(0, Math.min(columns.length, index)), [map]);
  }, "local");
  return colId;
}

export function deleteColumn(doc: Y.Doc, colId: string): void {
  doc.transact(() => {
    const columns = columnsOf(doc);
    for (let i = 0; i < columns.length; i += 1) {
      if (columns.get(i).get("colId") === colId) {
        columns.delete(i, 1);
        break;
      }
    }
    const rows = rowsOf(doc);
    for (let i = 0; i < rows.length; i += 1) {
      (rows.get(i).get("cells") as Y.Map<string>).delete(colId);
    }
  }, "local");
}
