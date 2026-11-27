import { useMemo, useRef, useSyncExternalStore } from "react";
import type { Value } from "../ycsv-formula/eval";
import { literal } from "../sheets-core/engine/engine";
import type { ValueSource } from "../sheets-core/engine/host";
import type { SheetColumn, Workbook } from "../sheets-core/model/view";

export type SheetRow = { rowId: string };
export type ValueLookup = { get(key: string): Value | undefined };

/**
 * Integration slice: replaces the prototype's `useSheet` (full re-read + `evaluateAll` per
 * change, spike 4's `baseline`). The grid gets
 * - `rows`, `columns`: the sheet view's resolved order (rebuilt on structural changes only);
 * - `values`: a lookup keyed `ref@rowId` like the old Map, so the grid's rendering code is
 *   unchanged. Literals are read from the Y.Doc (paint at once); formulas come from the
 *   engine host (main thread or worker).
 * A new `values` object per doc or engine change makes the memoised rows re-render.
 */
export function useSheetData(book: Workbook, sheetId: string, source: ValueSource) {
  const bookVersion = useSyncExternalStore(book.subscribe, book.getVersion);
  const valuesVersion = useSyncExternalStore(source.subscribe, source.getVersion);
  const view = book.view(sheetId);
  if (!view) throw new Error(`no sheet ${sheetId}`);
  const rowIds = view.rowIds;
  const columns: SheetColumn[] = view.columns;
  const rowCache = useRef(new Map<string, SheetRow>());
  const rows = useMemo(() => {
    const cache = rowCache.current;
    const next = new Map<string, SheetRow>();
    const out = rowIds.map((rowId) => {
      const row = cache.get(rowId) ?? { rowId };
      next.set(rowId, row);
      return row;
    });
    rowCache.current = next;
    return out;
  }, [rowIds]);
  const values = useMemo<ValueLookup>(() => {
    const colIdByRef = new Map(columns.map((col) => [col.ref, col.colId]));
    return {
      get(key) {
        const at = key.lastIndexOf("@");
        const ref = key.slice(0, at);
        const rowId = key.slice(at + 1);
        const colId = colIdByRef.get(ref);
        if (colId === undefined) return undefined;
        const raw = view.rawById(rowId, colId);
        if (raw.charCodeAt(0) !== 61) return literal(raw);
        return source.formulaValue(sheetId, ref, rowId) ?? "";
      },
    };
    // A new lookup per doc or engine change.
  }, [columns, view, source, sheetId, bookVersion, valuesVersion]);
  return { columns, rows, values, view, version: bookVersion + valuesVersion };
}
