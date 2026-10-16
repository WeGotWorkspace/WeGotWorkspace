import * as Y from "yjs";
import { newRowId } from "./ids";
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
  for (let i = 0; i < columns.length; i += 1) {
    const map = columns.get(i);
    cols.push({ colId: String(map.get("colId") ?? ""), ref: String(map.get("ref") ?? "") });
  }
  const rowIds: string[] = [];
  for (let i = 0; i < rows.length; i += 1) rowIds.push(String(rows.get(i).get("rowId") ?? ""));
  return { cols, rowIds };
}

export function setCell(doc: Y.Doc, rowId: string, colId: string, fileFormValue: string): void {
  doc.transact(() => {
    const { cols, rowIds } = snapshot(doc);
    const idForm = toIdForm(fileFormValue, cols, rowIds);
    const rows = rowsOf(doc);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows.get(i);
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
