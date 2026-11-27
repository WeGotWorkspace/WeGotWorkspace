import type * as Y from "yjs";
import type { ColumnType } from "../../ycsv-core/types";
import { resolveOrder } from "./order";
import { bookOf, partsOf, sheetIds, sheetOrderOf, sheetsOf, type SheetParts } from "./workbook";

export type SheetColumn = {
  colId: string;
  ref: string;
  name?: string;
  type?: ColumnType;
  currency?: string;
  locale?: string;
  width?: number;
};

export function readColumn(colId: string, map: Y.Map<unknown> | undefined): SheetColumn {
  const rest = map?.get("rest");
  const record = rest && typeof rest === "object" ? (rest as Record<string, unknown>) : {};
  const name = map?.get("name");
  const type = map?.get("type");
  const width = map?.get("width");
  return {
    colId,
    ref: String(map?.get("ref") ?? ""),
    name: typeof name === "string" ? name : undefined,
    type: typeof type === "string" ? (type as ColumnType) : undefined,
    currency: typeof record.currency === "string" ? record.currency : undefined,
    locale: typeof record.locale === "string" ? record.locale : undefined,
    width: typeof width === "number" ? width : typeof record.width === "number" ? record.width : undefined,
  };
}

/**
 * Main-thread read cache of one sheet: the resolved row and column order (spike 9 read rule)
 * and index maps. Rebuilt lazily after a structural change, never on a cell edit, so a
 * cell edit at 50k rows costs no O(rows) work on the main thread (spike 4's `setCell` scan
 * cost 6 ms at 50k).
 *
 * Inside an open transaction the cache can be stale (observers fire at its end); `fresh()`
 * resolves from the live arrays for code that mutates and reads in one transaction.
 */
export class SheetView {
  readonly parts: SheetParts;
  private rows: { ids: string[]; index: Map<string, number> } | null = null;
  private cols: { list: SheetColumn[]; ids: string[]; refs: string[]; index: Map<string, number> } | null = null;
  private readonly onRows = () => {
    this.rows = null;
  };
  private readonly onCols = () => {
    this.cols = null;
  };

  constructor(
    readonly doc: Y.Doc,
    readonly id: string,
  ) {
    const map = sheetsOf(doc).get(id);
    if (!map) throw new Error(`no sheet ${id}`);
    this.parts = partsOf(map);
    this.parts.rowOrder.observe(this.onRows);
    // Shallow: row added or removed. Cell edits inside a row do not touch the order.
    this.parts.rowData.observe(this.onRows);
    this.parts.colOrder.observe(this.onCols);
    this.parts.colData.observeDeep(this.onCols);
  }

  destroy(): void {
    this.parts.rowOrder.unobserve(this.onRows);
    this.parts.rowData.unobserve(this.onRows);
    this.parts.colOrder.unobserve(this.onCols);
    this.parts.colData.unobserveDeep(this.onCols);
  }

  private inTransaction(): boolean {
    return (this.doc as unknown as { _transaction: unknown })._transaction !== null;
  }

  private rowState() {
    if (this.rows && !this.inTransaction()) return this.rows;
    const ids = resolveOrder(this.parts.rowOrder.toArray(), this.parts.rowData);
    const index = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 1) index.set(ids[i] as string, i);
    const state = { ids, index };
    if (!this.inTransaction()) this.rows = state;
    return state;
  }

  private colState() {
    if (this.cols && !this.inTransaction()) return this.cols;
    const ids = resolveOrder(this.parts.colOrder.toArray(), this.parts.colData);
    const list = ids.map((colId) => readColumn(colId, this.parts.colData.get(colId)));
    const index = new Map<string, number>();
    ids.forEach((id, i) => index.set(id, i));
    const state = { list, ids, refs: list.map((col) => col.ref), index };
    if (!this.inTransaction()) this.cols = state;
    return state;
  }

  get ref(): string {
    return String(this.parts.map.get("ref") ?? "");
  }
  get name(): string {
    const name = this.parts.map.get("name");
    return typeof name === "string" ? name : this.ref;
  }
  get rowIds(): string[] {
    return this.rowState().ids;
  }
  get rowIndex(): Map<string, number> {
    return this.rowState().index;
  }
  get columns(): SheetColumn[] {
    return this.colState().list;
  }
  get colIds(): string[] {
    return this.colState().ids;
  }
  get colRefs(): string[] {
    return this.colState().refs;
  }
  get colIndex(): Map<string, number> {
    return this.colState().index;
  }
  get meta(): Y.Map<unknown> {
    return this.parts.meta;
  }

  rawById(rowId: string, colId: string): string {
    return this.parts.rowData.get(rowId)?.get(colId) ?? "";
  }

  raw(r: number, c: number): string {
    const rowId = this.rowIds[r];
    const colId = this.colIds[c];
    return rowId && colId ? this.rawById(rowId, colId) : "";
  }

  colIdByRef(ref: string): string | undefined {
    const i = this.colRefs.indexOf(ref);
    return i < 0 ? undefined : this.colIds[i];
  }
}

/**
 * Main-thread façade over a workbook doc: one cached view per sheet, the sheet order, and
 * one change counter for React (`useSyncExternalStore`).
 */
export class Workbook {
  private readonly views = new Map<string, SheetView>();
  private ids: string[] | null = null;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly onSheets = () => {
    this.ids = null;
    for (const [id, view] of this.views) {
      if (!sheetsOf(this.doc).has(id)) {
        view.destroy();
        this.views.delete(id);
      }
    }
  };
  private readonly onTransaction = (tr: Y.Transaction) => {
    if (tr.changed.size === 0) return;
    this.version += 1;
    for (const listener of this.listeners) listener();
  };

  constructor(readonly doc: Y.Doc) {
    sheetsOf(doc).observe(this.onSheets);
    sheetOrderOf(doc).observe(this.onSheets);
    doc.on("afterTransaction", this.onTransaction);
  }

  destroy(): void {
    sheetsOf(this.doc).unobserve(this.onSheets);
    sheetOrderOf(this.doc).unobserve(this.onSheets);
    this.doc.off("afterTransaction", this.onTransaction);
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    this.listeners.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  sheetIds(): string[] {
    if (!this.ids) this.ids = sheetIds(this.doc);
    return this.ids;
  }

  view(sheetId: string): SheetView | null {
    let view = this.views.get(sheetId);
    if (!view) {
      if (!sheetsOf(this.doc).has(sheetId)) return null;
      view = new SheetView(this.doc, sheetId);
      this.views.set(sheetId, view);
    }
    return view;
  }

  sheetIdByRef(ref: string): string | null {
    for (const id of this.sheetIds()) if (this.view(id)?.ref === ref) return id;
    return null;
  }

  /** Top-level defs merged with the sheet's own (sheet wins), as the spec says. */
  defs(sheetId: string): Record<string, unknown> {
    const book = bookOf(this.doc).get("defs");
    const own = this.view(sheetId)?.meta.get("defs");
    return {
      ...(book && typeof book === "object" ? (book as Record<string, unknown>) : {}),
      ...(own && typeof own === "object" ? (own as Record<string, unknown>) : {}),
    };
  }
}
