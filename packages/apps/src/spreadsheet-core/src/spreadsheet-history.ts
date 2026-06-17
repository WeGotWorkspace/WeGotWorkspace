import type { SpreadsheetGridSelection } from "@/spreadsheet-core/src/spreadsheet-grid";
import type { SheetColumnWidthState } from "@/spreadsheet-core/src/spreadsheet-column-widths";
import type { ParsedWorkbook } from "@/spreadsheet-core/src/ycsv/ycsv";

export const SPREADSHEET_HISTORY_MAX = 50;

export type SpreadsheetHistorySnapshot = {
  source: string;
  workbookOverride: ParsedWorkbook | null;
  activeSheetIndex: number;
  activeCell: { row: number; column: number } | null;
  selection: SpreadsheetGridSelection;
  columnWidthsBySheet: Record<string, SheetColumnWidthState>;
};

export type SpreadsheetHistoryState = {
  undo: SpreadsheetHistorySnapshot[];
  redo: SpreadsheetHistorySnapshot[];
};

export function cloneColumnWidthsBySheet(
  state: Record<string, SheetColumnWidthState>,
): Record<string, SheetColumnWidthState> {
  return Object.fromEntries(
    Object.entries(state).map(([key, value]) => [
      key,
      { widths: [...value.widths], manualCols: new Set(value.manualCols) },
    ]),
  );
}

export function cloneWorkbook(workbook: ParsedWorkbook | null): ParsedWorkbook | null {
  if (!workbook) return null;
  return JSON.parse(JSON.stringify(workbook)) as ParsedWorkbook;
}

export function captureSpreadsheetSnapshot(input: {
  source: string;
  workbookOverride: ParsedWorkbook | null;
  activeSheetIndex: number;
  activeCell: { row: number; column: number } | null;
  selection: SpreadsheetGridSelection;
  columnWidthsBySheet: Record<string, SheetColumnWidthState>;
}): SpreadsheetHistorySnapshot {
  return {
    source: input.source,
    workbookOverride: cloneWorkbook(input.workbookOverride),
    activeSheetIndex: input.activeSheetIndex,
    activeCell: input.activeCell ? { ...input.activeCell } : null,
    selection: input.selection ? { ...input.selection } : null,
    columnWidthsBySheet: cloneColumnWidthsBySheet(input.columnWidthsBySheet),
  };
}

export function pushSpreadsheetHistory(
  stack: SpreadsheetHistorySnapshot[],
  snapshot: SpreadsheetHistorySnapshot,
): SpreadsheetHistorySnapshot[] {
  const next = [...stack, captureSpreadsheetSnapshot(snapshot)];
  if (next.length <= SPREADSHEET_HISTORY_MAX) return next;
  return next.slice(next.length - SPREADSHEET_HISTORY_MAX);
}

export function popSpreadsheetUndo(
  undo: SpreadsheetHistorySnapshot[],
): { snapshot: SpreadsheetHistorySnapshot; undo: SpreadsheetHistorySnapshot[] } | null {
  if (undo.length === 0) return null;
  const snapshot = undo[undo.length - 1]!;
  return { snapshot, undo: undo.slice(0, -1) };
}

export function popSpreadsheetRedo(
  redo: SpreadsheetHistorySnapshot[],
): { snapshot: SpreadsheetHistorySnapshot; redo: SpreadsheetHistorySnapshot[] } | null {
  if (redo.length === 0) return null;
  const snapshot = redo[redo.length - 1]!;
  return { snapshot, redo: redo.slice(0, -1) };
}
