import type { SpreadsheetGridSelection } from "@/spreadsheet-core/src/spreadsheet-grid";
import {
  cellRefFor,
  columnLabelForRef,
  rangeRefFor,
  type CellPoint,
} from "@/spreadsheet-core/src/formula-ref-pick";
import { colLetter, type ColumnSetting, type ParsedSheet } from "@/spreadsheet-core/src/ycsv/ycsv";

/** Static YCSV cell/column style (v1 — no conditional formula UI). */
export type YcsvCellStyle = {
  bold?: boolean;
  border?: boolean;
  fill?: string;
  color?: string;
};

export type SheetCells = Record<string, { style: YcsvCellStyle }>;

export type ResolvedCellStyle = {
  bold: boolean;
  border: boolean;
  fill?: string;
  color?: string;
};

export type StyleApplyTarget = { kind: "column"; column: number } | { kind: "cells"; key: string };

export type SelectionStyleState = {
  bold: boolean | "mixed";
  border: boolean | "mixed";
  fill: string | "mixed" | null;
};

const HEX_FILL_RE = /^#[0-9A-Fa-f]{6}$/;

export function parseYcsvCellStyle(raw: unknown): YcsvCellStyle | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const style: YcsvCellStyle = {};
  const obj = raw as Record<string, unknown>;
  if (typeof obj.bold === "boolean") style.bold = obj.bold;
  if (typeof obj.border === "boolean") style.border = obj.border;
  if (typeof obj.fill === "string" && HEX_FILL_RE.test(obj.fill)) style.fill = obj.fill;
  if (typeof obj.color === "string" && HEX_FILL_RE.test(obj.color)) style.color = obj.color;
  return Object.keys(style).length ? style : undefined;
}

export function parseSheetCells(raw: unknown): SheetCells {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SheetCells = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const styleRaw = (value as Record<string, unknown>).style;
    const style = parseYcsvCellStyle(styleRaw);
    if (style) out[key] = { style };
  }
  return out;
}

function columnStyleOf(columnSettings: ColumnSetting[], column: number): YcsvCellStyle | undefined {
  const raw = columnSettings[column]?.style;
  return parseYcsvCellStyle(raw);
}

function staticStyleValue(value: unknown): string | boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && HEX_FILL_RE.test(value)) return value;
  return undefined;
}

function mergeStyles(
  columnStyle: YcsvCellStyle | undefined,
  cellStyle: YcsvCellStyle | undefined,
): ResolvedCellStyle {
  const bold = Boolean(staticStyleValue(cellStyle?.bold) ?? staticStyleValue(columnStyle?.bold));
  const border = Boolean(
    staticStyleValue(cellStyle?.border) ?? staticStyleValue(columnStyle?.border),
  );
  const fill =
    (staticStyleValue(cellStyle?.fill) as string | undefined) ??
    (staticStyleValue(columnStyle?.fill) as string | undefined);
  const color =
    (staticStyleValue(cellStyle?.color) as string | undefined) ??
    (staticStyleValue(columnStyle?.color) as string | undefined);
  return { bold, border, fill, color };
}

function parseCellRefKey(
  key: string,
  columnSettings: ColumnSetting[],
): { row: number; column: number } | null {
  const named = key.match(/^([a-z][a-z0-9_]*)(\d+)$/i);
  if (named) {
    const ref = named[1].toLowerCase();
    const row = parseInt(named[2], 10) - 1;
    const column = columnSettings.findIndex((c) => c.ref?.toLowerCase() === ref);
    if (column >= 0 && row >= 0) return { row, column };
  }
  const letter = key.match(/^([A-Z]+)(\d+)$/);
  if (letter) {
    let col = 0;
    for (const ch of letter[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    col -= 1;
    const row = parseInt(letter[2], 10) - 1;
    if (col >= 0 && row >= 0) return { row, column: col };
  }
  return null;
}

function parseRangeKey(
  key: string,
  columnSettings: ColumnSetting[],
): { start: CellPoint; end: CellPoint } | null {
  const parts = key.split(":");
  if (parts.length !== 2) return null;
  const start = parseCellRefKey(parts[0], columnSettings);
  const end = parseCellRefKey(parts[1], columnSettings);
  if (!start || !end) return null;
  return { start, end };
}

function columnIndexForRefKey(key: string, columnSettings: ColumnSetting[]): number | null {
  const lower = key.toLowerCase();
  const idx = columnSettings.findIndex((c) => c.ref?.toLowerCase() === lower);
  return idx >= 0 ? idx : null;
}

function cellInRange(row: number, column: number, start: CellPoint, end: CellPoint): boolean {
  const r1 = Math.min(start.row, end.row);
  const r2 = Math.max(start.row, end.row);
  const c1 = Math.min(start.column, end.column);
  const c2 = Math.max(start.column, end.column);
  return row >= r1 && row <= r2 && column >= c1 && column <= c2;
}

/** Resolve effective static styling for one parent-coord cell. */
export function resolveCellStyle(
  row: number,
  column: number,
  columnSettings: ColumnSetting[],
  cells: SheetCells = {},
): ResolvedCellStyle {
  const columnStyle = columnStyleOf(columnSettings, column);
  let cellStyle: YcsvCellStyle | undefined;

  for (const [key, entry] of Object.entries(cells)) {
    const colOnly = columnIndexForRefKey(key, columnSettings);
    if (colOnly != null && colOnly === column) {
      cellStyle = { ...cellStyle, ...entry.style };
      continue;
    }
    const range = parseRangeKey(key, columnSettings);
    if (range && cellInRange(row, column, range.start, range.end)) {
      cellStyle = { ...cellStyle, ...entry.style };
      continue;
    }
    const single = parseCellRefKey(key, columnSettings);
    if (single && single.row === row && single.column === column) {
      cellStyle = { ...cellStyle, ...entry.style };
    }
  }

  return mergeStyles(columnStyle, cellStyle);
}

function enumerateCellsInSelection(
  selection: SpreadsheetGridSelection,
  columnCount: number,
  rowCount: number,
): CellPoint[] {
  if (!selection) return [];
  if (selection.kind === "cell") return [{ row: selection.row, column: selection.column }];
  if (selection.kind === "range") {
    const r1 = Math.min(selection.start.row, selection.end.row);
    const r2 = Math.max(selection.start.row, selection.end.row);
    const c1 = Math.min(selection.start.column, selection.end.column);
    const c2 = Math.max(selection.start.column, selection.end.column);
    const out: CellPoint[] = [];
    for (let row = r1; row <= r2; row++) {
      for (let column = c1; column <= c2; column++) out.push({ row, column });
    }
    return out;
  }
  if (selection.kind === "rows") {
    const r1 = Math.min(selection.start, selection.end);
    const r2 = Math.max(selection.start, selection.end);
    const out: CellPoint[] = [];
    for (let row = r1; row <= r2; row++) {
      for (let column = 0; column < columnCount; column++) out.push({ row, column });
    }
    return out;
  }
  if (selection.kind === "cols") {
    const c1 = Math.min(selection.start, selection.end);
    const c2 = Math.max(selection.start, selection.end);
    const out: CellPoint[] = [];
    for (let column = c1; column <= c2; column++) {
      for (let row = 0; row < rowCount; row++) out.push({ row, column });
    }
    return out;
  }
  return [];
}

/** Map the current grid selection to column-level and/or cells-map write targets. */
export function styleApplyTargetsForSelection(
  selection: SpreadsheetGridSelection,
  columnSettings: ColumnSetting[],
  rowCount: number,
): StyleApplyTarget[] {
  if (!selection) return [];

  if (selection.kind === "cols") {
    const c1 = Math.min(selection.start, selection.end);
    const c2 = Math.max(selection.start, selection.end);
    const targets: StyleApplyTarget[] = [];
    for (let column = c1; column <= c2; column++) targets.push({ kind: "column", column });
    return targets;
  }

  const colCount = columnSettings.length;
  const matrixRowCount = rowCount + 1;

  if (selection.kind === "cell") {
    return [{ kind: "cells", key: cellRefFor(selection.row, selection.column, columnSettings) }];
  }

  if (selection.kind === "range") {
    return [
      {
        kind: "cells",
        key: rangeRefFor(selection.start, selection.end, columnSettings),
      },
    ];
  }

  if (selection.kind === "rows") {
    const r1 = Math.min(selection.start, selection.end);
    const r2 = Math.max(selection.start, selection.end);
    const start = { row: r1, column: 0 };
    const end = { row: r2, column: Math.max(0, colCount - 1) };
    return [{ kind: "cells", key: rangeRefFor(start, end, columnSettings) }];
  }

  void matrixRowCount;
  return [];
}

function readColumnStyleValue(
  columnSettings: ColumnSetting[],
  column: number,
  field: keyof YcsvCellStyle,
): boolean | string | undefined {
  const style = columnStyleOf(columnSettings, column);
  return staticStyleValue(style?.[field]);
}

function readCellOverrideValue(
  row: number,
  column: number,
  columnSettings: ColumnSetting[],
  cells: SheetCells,
  field: keyof YcsvCellStyle,
): boolean | string | undefined {
  for (const [key, entry] of Object.entries(cells)) {
    const colOnly = columnIndexForRefKey(key, columnSettings);
    if (colOnly != null && colOnly === column) {
      const v = staticStyleValue(entry.style[field]);
      if (v !== undefined) return v;
    }
    const range = parseRangeKey(key, columnSettings);
    if (range && cellInRange(row, column, range.start, range.end)) {
      const v = staticStyleValue(entry.style[field]);
      if (v !== undefined) return v;
    }
    const single = parseCellRefKey(key, columnSettings);
    if (single && single.row === row && single.column === column) {
      const v = staticStyleValue(entry.style[field]);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function effectiveFieldValue(
  row: number,
  column: number,
  columnSettings: ColumnSetting[],
  cells: SheetCells,
  field: keyof YcsvCellStyle,
): boolean | string | undefined {
  const override = readCellOverrideValue(row, column, columnSettings, cells, field);
  if (override !== undefined) return override;
  return readColumnStyleValue(columnSettings, column, field);
}

function aggregateField<T extends boolean | string | null>(values: T[]): T | "mixed" {
  if (!values.length) return "mixed";
  const first = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== first) return "mixed";
  }
  return first;
}

/** Read toolbar toggle state for the active selection. */
export function selectionStyleState(
  selection: SpreadsheetGridSelection,
  sheet: Pick<ParsedSheet, "columnSettings" | "cells" | "rows">,
): SelectionStyleState | null {
  if (!selection) return null;
  const cells = sheet.cells ?? {};
  const rowCount = sheet.rows.length;
  const points = enumerateCellsInSelection(selection, sheet.columnSettings.length, rowCount);
  if (!points.length) return null;

  const boldValues = points.map((p) =>
    Boolean(effectiveFieldValue(p.row, p.column, sheet.columnSettings, cells, "bold")),
  );
  const borderValues = points.map((p) =>
    Boolean(effectiveFieldValue(p.row, p.column, sheet.columnSettings, cells, "border")),
  );
  const fillValues = points.map((p) => {
    const v = effectiveFieldValue(p.row, p.column, sheet.columnSettings, cells, "fill");
    return typeof v === "string" ? v : null;
  });

  return {
    bold: aggregateField(boldValues),
    border: aggregateField(borderValues),
    fill: aggregateField(fillValues),
  };
}

function pruneStyle(style: YcsvCellStyle): YcsvCellStyle | undefined {
  const next: YcsvCellStyle = {};
  if (style.bold === true) next.bold = true;
  if (style.border === true) next.border = true;
  if (style.fill) next.fill = style.fill;
  if (style.color) next.color = style.color;
  return Object.keys(next).length ? next : undefined;
}

function patchStyleRecord(
  current: YcsvCellStyle | undefined,
  patch: Partial<Pick<YcsvCellStyle, "bold" | "border" | "fill">>,
): YcsvCellStyle | undefined {
  const next: YcsvCellStyle = { ...current };
  if (patch.bold !== undefined) {
    if (patch.bold) next.bold = true;
    else delete next.bold;
  }
  if (patch.border !== undefined) {
    if (patch.border) next.border = true;
    else delete next.border;
  }
  if (patch.fill !== undefined) {
    if (patch.fill) next.fill = patch.fill;
    else delete next.fill;
  }
  return pruneStyle(next);
}

function patchColumnSettingsStyle(
  columnSettings: ColumnSetting[],
  column: number,
  patch: Partial<Pick<YcsvCellStyle, "bold" | "border" | "fill">>,
): ColumnSetting[] {
  const current = columnSettings[column];
  if (!current) return columnSettings;
  const style = patchStyleRecord(parseYcsvCellStyle(current.style), patch);
  const nextCol: ColumnSetting = { ...current };
  if (style) nextCol.style = style;
  else delete nextCol.style;
  return columnSettings.map((c, i) => (i === column ? nextCol : c));
}

function patchCellsMap(
  cells: SheetCells,
  key: string,
  patch: Partial<Pick<YcsvCellStyle, "bold" | "border" | "fill">>,
): SheetCells {
  const current = cells[key]?.style;
  const style = patchStyleRecord(current, patch);
  const next = { ...cells };
  if (style) next[key] = { style };
  else delete next[key];
  return next;
}

export type ApplyStylePatch = Partial<Pick<YcsvCellStyle, "bold" | "border" | "fill">>;

/** Apply a style patch to the active sheet for the given selection targets. */
export function applyStyleToSheet(
  sheet: ParsedSheet,
  selection: SpreadsheetGridSelection,
  patch: ApplyStylePatch,
): ParsedSheet {
  const targets = styleApplyTargetsForSelection(selection, sheet.columnSettings, sheet.rows.length);
  if (!targets.length) return sheet;

  let columnSettings = sheet.columnSettings;
  let cells = { ...(sheet.cells ?? {}) };

  for (const target of targets) {
    if (target.kind === "column") {
      columnSettings = patchColumnSettingsStyle(columnSettings, target.column, patch);
    } else {
      cells = patchCellsMap(cells, target.key, patch);
    }
  }

  const nextCells = Object.keys(cells).length ? cells : undefined;
  return { ...sheet, columnSettings, cells: nextCells };
}

/** Toggle helper: all-on → off, otherwise on. */
export function toggleBooleanStyle(current: boolean | "mixed"): boolean {
  return current === true ? false : true;
}

export function columnStyleKey(column: number, columnSettings: ColumnSetting[]): string {
  return columnLabelForRef(column, columnSettings);
}

export function isNamedColumnRef(column: number, columnSettings: ColumnSetting[]): boolean {
  const ref = columnSettings[column]?.ref;
  return !!ref && /^[a-z][a-z0-9_]*$/.test(ref);
}

export { colLetter };
