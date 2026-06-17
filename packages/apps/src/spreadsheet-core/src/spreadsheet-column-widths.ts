import { measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";
import { colLetter, formatValue, type ColumnSetting } from "@/spreadsheet-core/src/ycsv/ycsv";
import type { ComputedCell } from "@/spreadsheet-core/src/ycsv/ycsv-formula-engine";

export const MIN_COL_WIDTH = 64;
export const MAX_COL_WIDTH = 600;
export const COL_CELL_PAD = 28;

export const GRID_FONT_FAMILY = "ui-sans-serif, system-ui, -apple-system, sans-serif";
export const CELL_FONT = `13px ${GRID_FONT_FAMILY}`;
export const HEADER_FONT = `600 13px ${GRID_FONT_FAMILY}`;
export const HEADER_BADGE_FONT = `500 10px ${GRID_FONT_FAMILY}`;

export const HEADER_PAD_X = 8;
export const HEADER_BADGE_GAP = 6;
export const HEADER_BADGE_H_PAD = 8;

type Cell = { value?: string } | undefined;

const widthCache = new Map<string, number>();

export function isNumericColumnType(type: string | undefined): boolean {
  return type === "number" || type === "currency" || type === "percent";
}

/** Measure single-line text width via pretext (cached per font+text). */
export function measurePretextWidth(text: string, font: string): number {
  if (!text) return 0;
  const key = `${font}\0${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  const prepared = prepareWithSegments(text, font);
  const width = measureNaturalWidth(prepared);
  widthCache.set(key, width);
  return width;
}

/** Clear pretext width cache (e.g. when font metrics may have changed). */
export function clearSpreadsheetColumnWidthCache(): void {
  widthCache.clear();
}

/** Display label for a column header (name, else ref, else A-Z letter). */
export function columnHeaderLabel(cs: ColumnSetting | undefined, colIndex: number): string {
  return cs?.name ?? cs?.ref ?? colLetter(colIndex);
}

/** Ref badge text when frontmatter defines an explicit ref distinct from the label. */
export function columnHeaderRefBadge(cs: ColumnSetting | undefined, colIndex: number): string {
  if (!cs?.refExplicit) return "";
  const label = columnHeaderLabel(cs, colIndex);
  return cs.ref && cs.ref !== label ? cs.ref : "";
}

/** Width of header label + optional ref badge as drawn in the grid header row. */
export function measureHeaderContentWidth(label: string, badge: string): number {
  const labelW = measurePretextWidth(label, HEADER_FONT);
  if (!badge) return HEADER_PAD_X + labelW + HEADER_PAD_X;
  const badgeW = measurePretextWidth(badge, HEADER_BADGE_FONT) + HEADER_BADGE_H_PAD;
  return HEADER_PAD_X + labelW + HEADER_BADGE_GAP + badgeW + HEADER_PAD_X;
}

function clampColumnWidth(contentWidth: number): number {
  return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.ceil(contentWidth) + COL_CELL_PAD));
}

function cellDisplayValue(
  raw: string,
  computed: ComputedCell | undefined,
  cs: ColumnSetting | undefined,
): string {
  const isFormula = raw.startsWith("=");
  const isErr = !!computed?.error;
  if (isFormula) {
    return isErr ? (computed?.display ?? "") : formatValue(computed?.display ?? "", cs);
  }
  return formatValue(raw, cs);
}

/** Auto-size one column to the widest header or cell value (formatted display). */
export function computeAutoColumnWidth(
  colIndex: number,
  columnSettings: ColumnSetting[],
  rawData: Cell[][],
  computed: ComputedCell[][],
  viewOffset: number,
): number {
  const cs = columnSettings[colIndex];
  const label = columnHeaderLabel(cs, colIndex);
  const badge = columnHeaderRefBadge(cs, colIndex);
  let maxW = measureHeaderContentWidth(label, badge);

  const headerCell = rawData[0]?.[colIndex]?.value ?? "";
  if (headerCell) {
    maxW = Math.max(maxW, measurePretextWidth(headerCell, HEADER_FONT) + HEADER_PAD_X * 2);
  }

  for (let r = viewOffset; r < rawData.length; r++) {
    const raw = rawData[r]?.[colIndex]?.value ?? "";
    const display = cellDisplayValue(raw, computed[r]?.[colIndex], cs);
    maxW = Math.max(maxW, measurePretextWidth(display, CELL_FONT) + HEADER_PAD_X * 2);
  }

  return clampColumnWidth(maxW);
}

/** Auto-size each column to the widest header or cell value (formatted display). */
export function computeAutoColumnWidths(
  colCount: number,
  columnSettings: ColumnSetting[],
  rawData: Cell[][],
  computed: ComputedCell[][],
  viewOffset: number,
): number[] {
  return Array.from({ length: colCount }, (_, i) =>
    computeAutoColumnWidth(i, columnSettings, rawData, computed, viewOffset),
  );
}

export type SheetColumnWidthState = {
  widths: number[];
  manualCols: Set<number>;
};

/** Merge stored widths with fresh auto widths, respecting manual resizes. */
export function resolveSheetColumnWidths(
  colCount: number,
  autoWidths: number[],
  state: SheetColumnWidthState | undefined,
): number[] {
  return Array.from({ length: colCount }, (_, i) => {
    if (state?.manualCols.has(i) && state.widths[i] != null) return state.widths[i]!;
    if (state?.widths[i] != null && i < state.widths.length) {
      return Math.max(state.widths[i]!, autoWidths[i] ?? MIN_COL_WIDTH);
    }
    return autoWidths[i] ?? MIN_COL_WIDTH;
  });
}

/** Apply auto widths for columns that are not manually resized. */
export function refreshAutoColumnWidths(
  state: SheetColumnWidthState,
  autoWidths: number[],
): SheetColumnWidthState {
  const widths = autoWidths.map((autoW, i) => (state.manualCols.has(i) ? state.widths[i]! : autoW));
  return { widths, manualCols: state.manualCols };
}

/** Append a single auto-sized column while preserving existing widths. */
export function appendAutoColumnWidth(
  state: SheetColumnWidthState | undefined,
  newColumnWidth: number,
): SheetColumnWidthState {
  const widths = [...(state?.widths ?? []), newColumnWidth];
  return { widths, manualCols: state?.manualCols ?? new Set() };
}
