import type * as Y from "yjs";

/**
 * Spike 9: one interface over three Yjs layouts for rows and columns, so the
 * same fuzz test, unit tests and benchmark run against each.
 *
 * Every mutation runs in one `doc.transact(…, "local")`, like `ycsv-model/mutate.ts`.
 * Targets are ids, never indices: `beforeId` = the row/column the moved or
 * inserted item lands in front of, `null` = at the end.
 */
export type Rng = () => number;

export type SeedCol = { id: string; ref: string };
export type SeedRow = { id: string; cells: Record<string, string> };

/** Raw anomalies before read-time repair. All zero in a clean doc. */
export type LayoutStats = {
  /** Order entries beyond the first for the same id (order-array, baseline). */
  duplicateRows: number;
  duplicateCols: number;
  /** Order entries whose data is gone (deleted concurrently). */
  orphanOrderRows: number;
  /** Rows/columns sharing a position key with another (frac-map). */
  tiedRows: number;
  tiedCols: number;
};

export interface SheetLayout {
  readonly name: string;
  /** Shared types the per-user UndoManager tracks. */
  roots(doc: Y.Doc): Y.AbstractType<unknown>[];
  seed(doc: Y.Doc, cols: SeedCol[], rows: SeedRow[], origin?: unknown): void;

  /** Resolved order: what the grid shows and the file serializes. */
  rowOrder(doc: Y.Doc): string[];
  colOrder(doc: Y.Doc): string[];
  colRef(doc: Y.Doc, colId: string): string | undefined;
  cell(doc: Y.Doc, rowId: string, colId: string): string | undefined;

  setCell(doc: Y.Doc, rowId: string, colId: string, value: string): void;
  insertRow(doc: Y.Doc, rowId: string, beforeId: string | null): void;
  deleteRow(doc: Y.Doc, rowId: string): void;
  /** Multi-row drag: `rowIds` land contiguously, in the given order, in front of `beforeId`. */
  moveRows(doc: Y.Doc, rowIds: string[], beforeId: string | null): void;
  /** Sort all rows by a column's raw value (numbers numerically, blanks last, stable). */
  sortRows(doc: Y.Doc, colId: string, descending?: boolean): void;

  insertCol(doc: Y.Doc, colId: string, ref: string, beforeId: string | null): void;
  deleteCol(doc: Y.Doc, colId: string): void;
  moveCol(doc: Y.Doc, colId: string, beforeId: string | null): void;
  renameCol(doc: Y.Doc, colId: string, ref: string): void;

  /** Optional write-back cleanup of raw anomalies; returns the number of fixes. */
  repair?(doc: Y.Doc): number;
  stats(doc: Y.Doc): LayoutStats;
}

export const LOCAL = "local";
