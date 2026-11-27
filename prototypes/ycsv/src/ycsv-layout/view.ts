import type * as Y from "yjs";
import type { YcsvFile } from "../ycsv-core/types";
import { refsThatMustBeQuoted, toFileForm, type ColInfo } from "../ycsv-model/refs";
import type { SheetLayout } from "./types";

/**
 * YCSV serialization for any layout: rows and columns in resolved order, ids
 * rendered back to file-form refs (`totaal@r_x` → `totaal7`). No layout puts
 * anything new in the file: position keys, order arrays and ids stay in the
 * Yjs sidecar, as row ids already do.
 */
export function layoutToFile(layout: SheetLayout, doc: Y.Doc, frontmatter: Record<string, unknown> = {}): YcsvFile {
  const colIds = layout.colOrder(doc);
  const cols: ColInfo[] = colIds.map((colId) => ({ colId, ref: layout.colRef(doc, colId) ?? "" }));
  const rowIds = layout.rowOrder(doc);
  const rowIndex = new Map<string, number>();
  rowIds.forEach((id, index) => rowIndex.set(id, index));
  const mustQuote = refsThatMustBeQuoted(cols.map((col) => col.ref));
  const rows = rowIds.map((rowId) =>
    cols.map((col) => toFileForm(layout.cell(doc, rowId, col.colId) ?? "", cols, rowIds, rowIndex, mustQuote)),
  );
  const columns = cols.map((col) => ({ ref: col.ref }));
  return {
    frontmatter: { ycsv_version: 1, ...frontmatter, columns },
    columns,
    header: cols.map((col) => col.ref),
    rows,
  };
}
