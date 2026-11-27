import type { ColInfo } from "../ycsv-model/refs";
import { bookToFileForm, bookToIdForm, docRefScope, type RefScope } from "../sheets-core/model";
import type { Workbook } from "../sheets-core/model/view";

/**
 * A read of one sheet for mutations. Handlers use this, not React state, so a paste right
 * after an insert (same transaction) sees the new rows. Integration slice: outside a
 * transaction it is the cached view (no O(rows) work per edit); file ↔ id form goes through
 * the workbook scope, so cross-sheet refs (`categorieën!label1`) convert too.
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
  scope: () => RefScope;
};

export function readSnap(book: Workbook, sheetId: string): Snap {
  const view = book.view(sheetId);
  if (!view) throw new Error(`no sheet ${sheetId}`);
  const colIds = view.colIds;
  const colRefs = view.colRefs;
  const colInfo: ColInfo[] = view.columns.map((col) => ({ colId: col.colId, ref: col.ref, header: col.name }));
  const rowIds = view.rowIds;
  const rowIndex = view.rowIndex;
  let scope: RefScope | null = null;
  const getScope = () => {
    if (!scope) {
      const base = docRefScope(book.doc, sheetId);
      scope = { ...base, self: { ...base.self, cols: colInfo, rowIds, rowIndex } };
    }
    return scope;
  };
  return {
    colIds,
    colRefs,
    colInfo,
    rowIds,
    rowIndex,
    raw: (r, c) => view.rawById(rowIds[r] ?? "", colIds[c] ?? ""),
    toId: (fileForm) => (fileForm.startsWith("=") ? bookToIdForm(fileForm, getScope()) : fileForm),
    toFile: (idForm) => (idForm.startsWith("=") ? bookToFileForm(idForm, getScope()) : idForm),
    scope: getScope,
  };
}
