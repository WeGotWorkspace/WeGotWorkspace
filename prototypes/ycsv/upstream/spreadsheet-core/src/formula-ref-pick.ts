import { OPEN_TOKEN_RE } from "@/spreadsheet-core/src/formula-suggest";
import { colLetter, type ColumnSetting } from "@/spreadsheet-core/src/ycsv/ycsv";

export type CellPoint = { row: number; column: number };

/** Column label used in formulas (named ref or A1 letter). */
export function columnLabelForRef(column: number, columnSettings: ColumnSetting[]): string {
  const cs = columnSettings[column];
  if (cs?.ref && /^[a-z][a-z0-9_]*$/.test(cs.ref)) return cs.ref;
  return colLetter(column);
}

/** Single-cell reference in the active sheet's column naming style. */
export function cellRefFor(row: number, column: number, columnSettings: ColumnSetting[]): string {
  return `${columnLabelForRef(column, columnSettings)}${row + 1}`;
}

/** Range reference; collapses to a single cell when start equals end. */
export function rangeRefFor(
  start: CellPoint,
  end: CellPoint,
  columnSettings: ColumnSetting[],
): string {
  const r1 = Math.min(start.row, end.row);
  const r2 = Math.max(start.row, end.row);
  const c1 = Math.min(start.column, end.column);
  const c2 = Math.max(start.column, end.column);
  if (r1 === r2 && c1 === c2) return cellRefFor(r1, c1, columnSettings);
  return `${cellRefFor(r1, c1, columnSettings)}:${cellRefFor(r2, c2, columnSettings)}`;
}

/** Whether the caret sits in an "open" formula slot awaiting a reference. */
export function isOpenFormulaContext(draft: string, caret: number): boolean {
  return draft.startsWith("=") && OPEN_TOKEN_RE.test(draft.slice(0, caret));
}

/**
 * Sheet ref immediately before the caret when typing `sheet!col` (e.g. `producten!pri`).
 * Returns null when the open token is not sheet-qualified.
 */
export function sheetRefBeforeCaret(draft: string, caret: number): string | null {
  const before = draft.slice(0, caret);
  const m = before.match(/([a-z][a-z0-9_]*)!([a-z][a-z0-9_]*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Prefix a cell/range ref with `sheet!` when it targets a different sheet than the formula context. */
export function withSheetPrefix(
  ref: string,
  targetSheetRef: string,
  contextSheetRef: string | null,
  activeSheetRef: string,
): string {
  const context = contextSheetRef ?? activeSheetRef;
  if (targetSheetRef.toLowerCase() === context.toLowerCase()) return ref;
  return `${targetSheetRef}!${ref}`;
}

export type InsertRefResult = {
  next: string;
  caret: number;
  insertedLen: number;
};

/** Insert or replace a reference token at the caret (Excel-style range extension). */
export function insertRefAtCaret(
  draft: string,
  caret: number,
  insertedLen: number,
  ref: string,
): InsertRefResult {
  const safeCaret = Math.min(caret, draft.length);
  const before = draft.slice(0, safeCaret - insertedLen);
  const after = draft.slice(safeCaret);
  const next = before + ref + after;
  const newCaret = before.length + ref.length;
  return { next, caret: newCaret, insertedLen: ref.length };
}

/** Nudge a cell point by arrow-key delta (clamped to non-negative indices). */
export function moveCellPoint(
  point: CellPoint,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  rowCount: number,
  colCount: number,
): CellPoint {
  let { row, column } = point;
  if (key === "ArrowUp") row = Math.max(0, row - 1);
  if (key === "ArrowDown") row = Math.min(rowCount - 1, row + 1);
  if (key === "ArrowLeft") column = Math.max(0, column - 1);
  if (key === "ArrowRight") column = Math.min(colCount - 1, column + 1);
  return { row, column };
}
