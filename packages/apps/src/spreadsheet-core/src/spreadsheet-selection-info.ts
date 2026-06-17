import type { SpreadsheetGridSelection } from "@/spreadsheet-core/src/spreadsheet-grid";
import type { SpreadsheetUILabels } from "@/spreadsheet-core/src/spreadsheet-labels";
import { colLetter, type ColumnSetting } from "@/spreadsheet-core/src/ycsv/ycsv";

export type SpreadsheetSelectionInfo = {
  label: string;
  value: string;
  multi: boolean;
};

function colLabelOf(columnSettings: ColumnSetting[], column: number): string {
  const cs = columnSettings[column];
  if (cs?.ref && /^[a-z][a-z0-9_]*$/.test(cs.ref)) return cs.ref;
  return colLetter(column);
}

function rangeLabel(
  start: { row: number; column: number },
  end: { row: number; column: number },
  columnSettings: ColumnSetting[],
): string {
  const r1 = Math.min(start.row, end.row);
  const c1 = Math.min(start.column, end.column);
  const r2 = Math.max(start.row, end.row);
  const c2 = Math.max(start.column, end.column);
  const a = `${colLabelOf(columnSettings, c1)}${r1 + 1}`;
  if (r1 === r2 && c1 === c2) return a;
  return `${a}:${colLabelOf(columnSettings, c2)}${r2 + 1}`;
}

/** Drives formula-bar label and read-only summary for multi-cell / row / column selections. */
export function selectionInfoFromGridSelection(
  selection: SpreadsheetGridSelection,
  columnSettings: ColumnSetting[],
  labels: SpreadsheetUILabels,
): SpreadsheetSelectionInfo | null {
  if (!selection) return null;

  if (selection.kind === "cols") {
    const c1 = Math.min(selection.start, selection.end);
    const c2 = Math.max(selection.start, selection.end);
    const label = c1 === c2 ? colLabelOf(columnSettings, c1) : `${colLabelOf(columnSettings, c1)}:${colLabelOf(columnSettings, c2)}`;
    const count = c2 - c1 + 1;
    return {
      label,
      value:
        count === 1
          ? labels.selectionEntireColumn(colLabelOf(columnSettings, c1))
          : labels.selectionColumns(count),
      multi: true,
    };
  }

  if (selection.kind === "rows") {
    const r1 = Math.min(selection.start, selection.end);
    const r2 = Math.max(selection.start, selection.end);
    const label = r1 === r2 ? `${r1 + 1}` : `${r1 + 1}:${r2 + 1}`;
    const count = r2 - r1 + 1;
    return {
      label,
      value: count === 1 ? labels.selectionEntireRow(r1 + 1) : labels.selectionRows(count),
      multi: true,
    };
  }

  if (selection.kind === "range") {
    if (selection.start.row === selection.end.row && selection.start.column === selection.end.column) {
      return null;
    }
    const count =
      (Math.abs(selection.end.row - selection.start.row) + 1) *
      (Math.abs(selection.end.column - selection.start.column) + 1);
    return {
      label: rangeLabel(selection.start, selection.end, columnSettings),
      value: labels.selectionCells(count),
      multi: true,
    };
  }

  return null;
}
