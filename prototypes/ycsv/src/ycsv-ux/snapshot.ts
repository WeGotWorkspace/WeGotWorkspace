import type * as Y from "yjs";
import { toFileForm, toIdForm, type ColInfo } from "../ycsv-model/refs";

/**
 * A fresh read of the doc for mutations. Handlers use this, not React state, so a
 * paste right after an insert (same transaction) sees the new rows.
 */
export type Snap = {
  colIds: string[];
  colRefs: string[];
  colInfo: ColInfo[];
  rowIds: string[];
  rowIndex: Map<string, number>;
  raw: (r: number, c: number) => string;
  toId: (fileForm: string) => string;
  toFile: (idForm: string) => string;
};

export function readSnap(doc: Y.Doc): Snap {
  const cols = doc.getArray<Y.Map<unknown>>("columns");
  const rows = doc.getArray<Y.Map<unknown>>("rows");
  const colIds: string[] = [];
  const colRefs: string[] = [];
  const colInfo: ColInfo[] = [];
  cols.forEach((col) => {
    const colId = String(col.get("colId"));
    const ref = String(col.get("ref") ?? "");
    const name = col.get("name");
    colIds.push(colId);
    colRefs.push(ref);
    colInfo.push({ colId, ref, header: typeof name === "string" ? name : undefined });
  });
  const rowIds: string[] = [];
  const cells: Y.Map<string>[] = [];
  rows.forEach((row) => {
    rowIds.push(String(row.get("rowId")));
    cells.push(row.get("cells") as Y.Map<string>);
  });
  const rowIndex = new Map<string, number>();
  rowIds.forEach((id, i) => rowIndex.set(id, i));
  return {
    colIds,
    colRefs,
    colInfo,
    rowIds,
    rowIndex,
    raw: (r, c) => cells[r]?.get(colIds[c] ?? "") ?? "",
    toId: (fileForm) => (fileForm.startsWith("=") ? toIdForm(fileForm, colInfo, rowIds) : fileForm),
    toFile: (idForm) => (idForm.startsWith("=") ? toFileForm(idForm, colInfo, rowIds, rowIndex) : idForm),
  };
}
