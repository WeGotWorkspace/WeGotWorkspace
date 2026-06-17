import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  GridColumnIcon,
  getMiddleCenterBias,
  type DataEditorRef,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type ProvideEditorCallback,
  type Rectangle,
  type CellClickedEventArgs,
} from "@glideapps/glide-data-grid";
import { cn } from "@/lib/utils";
import { formatValue, type ColumnSetting, type Defs } from "@/spreadsheet-core/src/ycsv/ycsv";
import type { ComputedCell } from "@/spreadsheet-core/src/ycsv/ycsv-formula-engine";
import {
  columnHeaderLabel,
  columnHeaderRefBadge,
  HEADER_BADGE_FONT,
  HEADER_BADGE_GAP,
  HEADER_BADGE_H_PAD,
  HEADER_FONT,
  isNumericColumnType,
  measurePretextWidth,
  MIN_COL_WIDTH,
} from "@/spreadsheet-core/src/spreadsheet-column-widths";
import { FormulaTokens, tokenizeFormula } from "@/spreadsheet-core/src/formula-highlight";
import { buildFormulaDefContext } from "@/spreadsheet-core/src/spreadsheet-defs-utils";
import {
  buildFormulaSheetContext,
  computeSuggestions,
  type FormulaSheetInfo,
  SuggestionList,
} from "@/spreadsheet-core/src/formula-suggest";
import {
  cellRefFor,
  isOpenFormulaContext,
  moveCellPoint,
  rangeRefFor,
  sheetRefBeforeCaret,
  withSheetPrefix,
  type CellPoint,
} from "@/spreadsheet-core/src/formula-ref-pick";
import {
  SpreadsheetGridProvider,
  useSpreadsheetGridContext,
  type CellFormulaEditBridge,
} from "@/spreadsheet-core/src/spreadsheet-grid-context";
import { SpreadsheetGridInsertControls } from "@/spreadsheet-core/src/spreadsheet-grid-insert-controls";
import { useSpreadsheetGridTheme } from "@/spreadsheet-core/src/spreadsheet-grid-theme";
import { resolveCellStyle, type SheetCells } from "@/spreadsheet-core/src/spreadsheet-cell-styles";

import "@glideapps/glide-data-grid/dist/index.css";

type Cell = { value?: string } | undefined;

const FORMULA_COLOR = "#2563eb";
const ERROR_COLOR = "#dc2626";

const PORTAL_THEME_VARS = [
  "--spreadsheet-accent",
  "--spreadsheet-surface",
  "--spreadsheet-border",
  "--spreadsheet-text",
  "--color-ink",
] as const;

/**
 * Glide renders its in-cell overlay editor into `document.getElementById("portal")`
 * and silently bails (no editor, console error) when that element is missing — which
 * breaks in-cell typing. Ensure the mount point exists wherever the grid is used
 * (app, Storybook, tests) so the editor can open.
 *
 * The portal sits on `document.body`, outside `.spreadsheet-workspace`, so copy
 * workspace theme tokens onto it for overlay chrome (border, shadow).
 */
function useGlidePortalRoot(containerRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    let portal = document.getElementById("portal");
    if (!portal) {
      portal = document.createElement("div");
      portal.id = "portal";
      portal.style.position = "fixed";
      portal.style.left = "0";
      portal.style.top = "0";
      portal.style.zIndex = "9999";
      document.body.appendChild(portal);
    }

    const workspace = containerRef.current?.closest(".spreadsheet-workspace");
    if (!workspace) return;
    const source = getComputedStyle(workspace);
    for (const prop of PORTAL_THEME_VARS) {
      const value = source.getPropertyValue(prop).trim();
      if (value) portal.style.setProperty(prop, value);
    }
  });
}

export type SpreadsheetGridSelection =
  | null
  | { kind: "cell"; row: number; column: number }
  | { kind: "range"; start: { row: number; column: number }; end: { row: number; column: number } }
  | { kind: "rows"; start: number; end: number }
  | { kind: "cols"; start: number; end: number };

export type SpreadsheetGridProps = {
  /** Raw cell matrix (parent-coords incl. header row). */
  rawData: Cell[][];
  /** Resolved display values per cell (same shape as rawData). */
  computed: ComputedCell[][];
  columnSettings: ColumnSetting[];
  cells?: SheetCells;
  defs: Defs;
  columnWidths: number[];
  onColumnResize: (column: number, width: number) => void;
  /** First row index visible in the grid (1 when the header row is hidden). */
  viewOffset: number;
  /** Active cell in parent-coords, or null. */
  active: { row: number; column: number } | null;
  onActivateCell: (p: { row: number; column: number }) => void;
  onSelect: (sel: SpreadsheetGridSelection) => void;
  writeCell: (row: number, column: number, value: string) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  addRowLabel: string;
  addColumnLabel: string;
  /** When true, clicking cells inserts refs into the formula bar instead of editing. */
  picking: boolean;
  /** Draft formula used for related-cell highlights while editing. */
  formulaHighlight?: string;
  /** Caret position in the formula draft (for sheet-prefix detection). */
  formulaCaret?: number;
  /** Insert a formatted reference while picking (formula bar). */
  onPickRef?: (ref: string) => void;
  /** Arrow-key navigation while picking (formula bar). */
  onPickingArrow?: (
    key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
    extend: boolean,
  ) => void;
  sheets?: FormulaSheetInfo[];
  activeSheetRef?: string;
};

/** Parse a raw formula into related-cell highlight regions (parent-coords). */
function parseFormulaRegions(
  raw: string,
  columnSettings: ColumnSetting[],
): { row: number; col: number; rows?: number; cols?: number }[] {
  if (!raw.startsWith("=")) return [];
  const consts = new Set<string>();
  const refs = new Set(columnSettings.filter((c) => c.ref).map((c) => c.ref!));
  const toks = tokenizeFormula(raw.slice(1), consts, refs);
  const refIdx = new Map<string, number>();
  columnSettings.forEach((c, i) => {
    if (c.ref) refIdx.set(c.ref, i);
  });
  const out: { row: number; col: number; rows?: number; cols?: number }[] = [];

  const letterCol = (s: string) => {
    let n = 0;
    for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    const after = toks[i + 2];
    if (t.type === "cellref") {
      const m = t.text.match(/^([A-Z]+)(\d+)$/);
      if (!m) continue;
      const c = letterCol(m[1]);
      const r = parseInt(m[2], 10) - 1;
      if (next?.type === "op" && next.text === ":" && after?.type === "cellref") {
        const m2 = after.text.match(/^([A-Z]+)(\d+)$/);
        if (m2) {
          const c2 = letterCol(m2[1]);
          const r2 = parseInt(m2[2], 10) - 1;
          out.push({
            row: Math.min(r, r2),
            col: Math.min(c, c2),
            rows: Math.abs(r2 - r) + 1,
            cols: Math.abs(c2 - c) + 1,
          });
          i += 2;
          continue;
        }
      }
      out.push({ row: r, col: c });
    } else if (t.type === "ref") {
      const m = t.text.match(/^([a-z][a-z0-9_]*?)(\d+)$/);
      if (m && refIdx.has(m[1])) {
        out.push({ row: parseInt(m[2], 10) - 1, col: refIdx.get(m[1])! });
      } else if (refIdx.has(t.text)) {
        out.push({ row: 0, col: refIdx.get(t.text)!, rows: 1_000_000 });
      }
    }
  }
  return out;
}

/** Map a viewport point to a grid cell using Glide bounds (grid row/col, not parent coords). */
function cellAtClientPoint(
  grid: DataEditorRef,
  clientX: number,
  clientY: number,
  colCount: number,
  rowCount: number,
): { col: number; row: number } | null {
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      const bounds = grid.getBounds(col, row);
      if (!bounds) continue;
      if (
        clientX >= bounds.x &&
        clientX < bounds.x + bounds.width &&
        clientY >= bounds.y &&
        clientY < bounds.y + bounds.height
      ) {
        return { col, row };
      }
    }
  }
  return null;
}

function gridSelectionForPick(
  sel: Extract<SpreadsheetGridSelection, { kind: "cell" | "range" }>,
  viewOffset: number,
): GridSelection {
  if (sel.kind === "cell") {
    const gridRow = sel.row - viewOffset;
    return {
      columns: CompactSelection.empty(),
      rows: CompactSelection.empty(),
      current: {
        cell: [sel.column, gridRow],
        range: { x: sel.column, y: gridRow, width: 1, height: 1 },
        rangeStack: [],
      },
    };
  }
  const startRow = sel.start.row - viewOffset;
  const endRow = sel.end.row - viewOffset;
  const left = Math.min(sel.start.column, sel.end.column);
  const right = Math.max(sel.start.column, sel.end.column);
  const top = Math.min(startRow, endRow);
  const bottom = Math.max(startRow, endRow);
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: {
      cell: [sel.end.column, endRow],
      range: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 },
      rangeStack: [],
    },
  };
}

/** Match Glide `drawSingleTextLine` padding and horizontal alignment. */
function drawAlignedHeaderText(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  theme: { cellHorizontalPadding: number; headerFontStyle: string; fontFamily: string },
  text: string,
  color: string,
  contentAlign?: "left" | "right" | "center",
) {
  const { x, y, width: w, height: h } = rect;
  const pad = theme.cellHorizontalPadding + 0.5;
  const headerFont = `${theme.headerFontStyle} ${theme.fontFamily}`;
  const bias = getMiddleCenterBias(ctx, headerFont);
  ctx.fillStyle = color;
  ctx.font = headerFont;
  if (contentAlign === "right") {
    ctx.textAlign = "right";
    ctx.fillText(text, x + w - pad, y + h / 2 + bias);
  } else if (contentAlign === "center") {
    ctx.textAlign = "center";
    ctx.fillText(text, x + w / 2, y + h / 2 + bias);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(text, x + pad, y + h / 2 + bias);
  }
  ctx.textAlign = "left";
}

export function SpreadsheetGrid({
  rawData,
  computed,
  columnSettings,
  cells = {},
  defs,
  columnWidths,
  onColumnResize,
  viewOffset,
  active,
  onActivateCell,
  onSelect,
  writeCell,
  onAddRow,
  onAddColumn,
  addRowLabel,
  addColumnLabel,
  picking,
  formulaHighlight,
  formulaCaret = 0,
  onPickRef,
  onPickingArrow,
  sheets = [],
  activeSheetRef = "",
}: SpreadsheetGridProps) {
  const gridRef = useRef<DataEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cellFormulaEditRef = useRef<CellFormulaEditBridge | null>(null);
  const [cellPicking, setCellPicking] = useState(false);
  const [cellFormulaDraft, setCellFormulaDraft] = useState("");
  const cellPickAnchorRef = useRef<CellPoint | null>(null);
  const isPicking = picking || cellPicking;
  useGlidePortalRoot(containerRef);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const bumpLayout = useCallback(() => {
    requestAnimationFrame(() => setLayoutEpoch((n) => n + 1));
  }, []);
  const { tokens: gridThemeTokens, glideTheme } = useSpreadsheetGridTheme(containerRef);
  const colCount = rawData[0]?.length ?? columnSettings.length ?? 1;
  const rowCount = Math.max(0, rawData.length - viewOffset);

  const inferType = useCallback(
    (col: number): "string" | "number" => {
      let nums = 0;
      let strs = 0;
      for (let r = viewOffset; r < rawData.length; r++) {
        const v = (rawData[r]?.[col]?.value ?? "").trim();
        if (!v) continue;
        if (v.startsWith("=") || /^-?\d+(\.\d+)?%?$/.test(v)) nums++;
        else strs++;
      }
      return nums > 0 && nums >= strs ? "number" : "string";
    },
    [rawData, viewOffset],
  );

  const colTypes = useMemo(
    () => Array.from({ length: colCount }, (_, i) => columnSettings[i]?.type ?? inferType(i)),
    [colCount, columnSettings, inferType],
  );

  const resolvedColumnWidths = useMemo(
    () => Array.from({ length: colCount }, (_, i) => columnWidths?.[i] ?? MIN_COL_WIDTH),
    [colCount, columnWidths],
  );

  const columns = useMemo<GridColumn[]>(() => {
    return Array.from({ length: colCount }, (_, i) => {
      const cs = columnSettings[i];
      const label = columnHeaderLabel(cs, i);
      const badge = columnHeaderRefBadge(cs, i);
      return {
        title: label,
        id: String(i),
        width: resolvedColumnWidths[i],
        icon: badge ? GridColumnIcon.HeaderString : undefined,
      };
    });
  }, [colCount, columnSettings, resolvedColumnWidths]);

  useEffect(() => {
    bumpLayout();
  }, [bumpLayout, colCount, resolvedColumnWidths, rowCount]);

  const handleColumnResize = useCallback(
    (_column: GridColumn, newSize: number, colIndex: number) => {
      onColumnResize(colIndex, newSize);
      bumpLayout();
    },
    [bumpLayout, onColumnResize],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const realRow = row + viewOffset;
      const raw = rawData[realRow]?.[col]?.value ?? "";
      const cmp = computed[realRow]?.[col];
      const isFormula = raw.startsWith("=");
      const isErr = !!cmp?.error;
      const colSpec = columnSettings[col];
      const t = colTypes[col];
      const isNum = isNumericColumnType(t);

      const display = isFormula
        ? isErr
          ? (cmp?.display ?? "")
          : formatValue(cmp?.display ?? "", colSpec)
        : formatValue(raw, colSpec);

      const styled = resolveCellStyle(realRow, col, columnSettings, cells);
      const themeOverride: GridCell["themeOverride"] = {};
      if (isErr) {
        themeOverride.textDark = ERROR_COLOR;
        themeOverride.textLight = ERROR_COLOR;
      } else if (isFormula) {
        themeOverride.textDark = FORMULA_COLOR;
        themeOverride.textLight = FORMULA_COLOR;
      }
      if (styled.fill) themeOverride.bgCell = styled.fill;
      if (styled.color) {
        themeOverride.textDark = styled.color;
        themeOverride.textLight = styled.color;
      }
      if (styled.bold) {
        themeOverride.baseFontStyle = "bold 13px";
        themeOverride.headerFontStyle = "bold 13px";
      }

      return {
        kind: GridCellKind.Text,
        data: raw,
        displayData: display,
        allowOverlay: true,
        readonly: false,
        contentAlign: isNum ? "right" : undefined,
        themeOverride: Object.keys(themeOverride).length ? themeOverride : undefined,
      };
    },
    [rawData, computed, columnSettings, cells, colTypes, viewOffset],
  );

  const borderCells = useMemo(() => {
    const out = new Set<string>();
    const rowCountParent = rawData.length;
    const colCountLocal = rawData[0]?.length ?? columnSettings.length;
    for (let row = 0; row < rowCountParent; row++) {
      for (let col = 0; col < colCountLocal; col++) {
        if (resolveCellStyle(row, col, columnSettings, cells).border) {
          out.add(`${col},${row - viewOffset}`);
        }
      }
    }
    return out;
  }, [cells, columnSettings, rawData, viewOffset]);

  const drawCell = useCallback<NonNullable<React.ComponentProps<typeof DataEditor>["drawCell"]>>(
    (args, drawContent) => {
      drawContent();
      const gridRow = args.row;
      if (!borderCells.has(`${args.col},${gridRow}`)) return;
      const { ctx, rect, theme } = args;
      ctx.strokeStyle = theme.textLight;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
    },
    [borderCells],
  );

  const onCellEdited = useCallback(
    ([col, row]: Item, newValue: EditableGridCell) => {
      const realRow = row + viewOffset;
      let v = "";
      if (newValue.kind === GridCellKind.Number) {
        v = newValue.data == null ? "" : String(newValue.data);
      } else if (newValue.kind === GridCellKind.Text) {
        v = String((newValue as { data?: string }).data ?? "");
      }
      writeCell(realRow, col, v);
    },
    [viewOffset, writeCell],
  );

  const [gridSel, setGridSel] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: undefined,
  });

  useEffect(() => {
    if (isPicking) return;
    if (!active) return;
    const gridRow = active.row - viewOffset;
    if (gridRow < 0 || gridRow >= rowCount) return;
    setGridSel((prev) => {
      if (prev.rows.length > 0 || prev.columns.length > 0) return prev;
      const cur = prev.current?.cell;
      if (cur && cur[0] === active.column && cur[1] === gridRow) return prev;
      return {
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
        current: {
          cell: [active.column, gridRow],
          range: { x: active.column, y: gridRow, width: 1, height: 1 },
          rangeStack: [],
        },
      };
    });
  }, [active, viewOffset, rowCount, isPicking]);

  const pickingRef = useRef(isPicking);
  useEffect(() => {
    pickingRef.current = isPicking;
  }, [isPicking]);

  const formatPickedRef = useCallback(
    (row: number, column: number, draft: string, caret: number) => {
      const bare = cellRefFor(row, column, columnSettings);
      const contextSheet = sheetRefBeforeCaret(draft, caret);
      return withSheetPrefix(bare, activeSheetRef, contextSheet, activeSheetRef);
    },
    [activeSheetRef, columnSettings],
  );

  const formatPickedRange = useCallback(
    (start: CellPoint, end: CellPoint, draft: string, caret: number) => {
      const bare = rangeRefFor(start, end, columnSettings);
      const contextSheet = sheetRefBeforeCaret(draft, caret);
      return withSheetPrefix(bare, activeSheetRef, contextSheet, activeSheetRef);
    },
    [activeSheetRef, columnSettings],
  );

  const insertPickedSelection = useCallback(
    (sel: SpreadsheetGridSelection) => {
      if (!sel) return;
      if (picking && onPickRef) {
        const draft = formulaHighlight ?? "";
        const caret = formulaCaret;
        if (sel.kind === "range") {
          onPickRef(formatPickedRange(sel.start, sel.end, draft, caret));
        } else if (sel.kind === "cell") {
          onPickRef(formatPickedRef(sel.row, sel.column, draft, caret));
        }
        return;
      }
      const bridge = cellFormulaEditRef.current;
      if (!cellPicking || !bridge) return;
      if (sel.kind === "range") {
        bridge.insertRef(formatPickedRange(sel.start, sel.end, bridge.draft, bridge.caret));
      } else if (sel.kind === "cell") {
        bridge.insertRef(formatPickedRef(sel.row, sel.column, bridge.draft, bridge.caret));
      }
    },
    [
      cellPicking,
      formatPickedRange,
      formatPickedRef,
      formulaHighlight,
      formulaCaret,
      onPickRef,
      picking,
    ],
  );

  const handleCellPickingArrow = useCallback(
    (key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", extend: boolean) => {
      const bridge = cellFormulaEditRef.current;
      if (!cellPicking || !bridge || !active) return;
      const origin = cellPickAnchorRef.current ?? active;
      if (!cellPickAnchorRef.current) cellPickAnchorRef.current = origin;
      const next = moveCellPoint(origin, key, rowCount, colCount);
      cellPickAnchorRef.current = next;
      const ref = extend
        ? formatPickedRange(active, next, bridge.draft, bridge.caret)
        : formatPickedRef(next.row, next.column, bridge.draft, bridge.caret);
      bridge.insertRef(ref);
    },
    [active, cellPicking, colCount, formatPickedRange, formatPickedRef, rowCount],
  );

  const pickShieldRef = useRef<HTMLDivElement>(null);

  const handleCellPickAtPoint = useCallback(
    (clientX: number, clientY: number, extend: boolean) => {
      if (!cellPicking || !active) return;
      const grid = gridRef.current;
      if (!grid) return;
      const hit = cellAtClientPoint(grid, clientX, clientY, colCount, rowCount);
      if (!hit) return;

      const picked = { row: hit.row + viewOffset, column: hit.col };
      let sel: SpreadsheetGridSelection;
      if (extend) {
        const anchor = cellPickAnchorRef.current ?? active;
        if (!cellPickAnchorRef.current) cellPickAnchorRef.current = anchor;
        sel = { kind: "range", start: anchor, end: picked };
      } else {
        cellPickAnchorRef.current = picked;
        sel = { kind: "cell", row: picked.row, column: picked.column };
      }

      setGridSel(gridSelectionForPick(sel, viewOffset));
      onSelect(sel);
      insertPickedSelection(sel);
    },
    [active, cellPicking, colCount, insertPickedSelection, onSelect, rowCount, viewOffset],
  );

  useEffect(() => {
    const shield = pickShieldRef.current;
    if (!shield || !cellPicking) return;
    const onMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      handleCellPickAtPoint(event.clientX, event.clientY, event.shiftKey);
    };
    shield.addEventListener("mousedown", onMouseDown, true);
    return () => shield.removeEventListener("mousedown", onMouseDown, true);
  }, [cellPicking, handleCellPickAtPoint]);

  const isOutsideClick = useCallback((event: MouseEvent | TouchEvent) => {
    if (!pickingRef.current) return true;
    const target = event.target;
    if (!(target instanceof Node)) return true;
    return !containerRef.current?.contains(target);
  }, []);

  const onCellClicked = useCallback((_cell: Item, args: CellClickedEventArgs) => {
    if (pickingRef.current) args.preventDefault();
  }, []);

  const onGridSelectionChange = useCallback(
    (newSel: GridSelection) => {
      setGridSel(newSel);

      if (newSel.rows.length > 0) {
        const arr: number[] = [];
        newSel.rows.toArray().forEach((r) => arr.push(r + viewOffset));
        if (arr.length) onSelect({ kind: "rows", start: Math.min(...arr), end: Math.max(...arr) });
        return;
      }
      if (newSel.columns.length > 0) {
        const arr = newSel.columns.toArray();
        if (arr.length) onSelect({ kind: "cols", start: Math.min(...arr), end: Math.max(...arr) });
        return;
      }

      const cur = newSel.current;
      if (!cur) {
        onSelect(null);
        return;
      }
      const cell = cur.cell;
      const range = cur.range;
      if (range.width > 1 || range.height > 1) {
        const start = { row: range.y + viewOffset, column: range.x };
        const end = {
          row: range.y + range.height - 1 + viewOffset,
          column: range.x + range.width - 1,
        };
        const sel = { kind: "range" as const, start, end };
        onSelect(sel);
        if (pickingRef.current) insertPickedSelection(sel);
        else onActivateCell({ row: cell[1] + viewOffset, column: cell[0] });
        return;
      }
      const p = { row: cell[1] + viewOffset, column: cell[0] };
      const sel = { kind: "cell" as const, row: p.row, column: p.column };
      onSelect(sel);
      if (pickingRef.current) insertPickedSelection(sel);
      else onActivateCell(p);
    },
    [insertPickedSelection, onSelect, onActivateCell, viewOffset],
  );

  const highlightRegions = useMemo(() => {
    if (!active) return undefined;
    const raw =
      (cellFormulaDraft && cellPicking ? cellFormulaDraft : null) ??
      formulaHighlight ??
      rawData[active.row]?.[active.column]?.value ??
      "";
    if (!raw.startsWith("=")) return undefined;
    const regs = parseFormulaRegions(raw, columnSettings);
    if (!regs.length) return undefined;
    const palette = [
      "hsla(217, 91%, 60%, 0.20)",
      "hsla(142, 71%, 45%, 0.20)",
      "hsla(38, 92%, 50%, 0.20)",
      "hsla(280, 70%, 60%, 0.20)",
    ];
    return regs.map((r, i) => {
      const gridRow = r.row - viewOffset;
      const height = Math.min(r.rows ?? 1, Math.max(1, rowCount - gridRow));
      return {
        color: palette[i % palette.length],
        range: {
          x: r.col,
          y: Math.max(0, gridRow),
          width: r.cols ?? 1,
          height: Math.max(1, height),
        },
        style: "solid" as const,
      };
    });
  }, [
    active,
    cellFormulaDraft,
    cellPicking,
    formulaHighlight,
    rawData,
    columnSettings,
    viewOffset,
    rowCount,
  ]);

  useEffect(() => {
    if (!isPicking) cellPickAnchorRef.current = null;
  }, [isPicking]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isPicking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!/^Arrow(Up|Down|Left|Right)$/.test(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(".spreadsheet-suggest")) return;
      if (picking && onPickingArrow) {
        event.preventDefault();
        onPickingArrow(
          event.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
          event.shiftKey,
        );
        return;
      }
      if (cellPicking) {
        event.preventDefault();
        handleCellPickingArrow(
          event.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
          event.shiftKey,
        );
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [cellPicking, handleCellPickingArrow, isPicking, onPickingArrow, picking]);

  const provideEditor = useCallback<ProvideEditorCallback<GridCell>>((cell) => {
    if (cell.kind !== GridCellKind.Text) return undefined;
    return {
      disablePadding: true,
      disableStyling: true,
      editor: FormulaCellEditor,
    } as ReturnType<ProvideEditorCallback<GridCell>>;
  }, []);

  const drawHeader = useCallback(
    (args: Parameters<NonNullable<React.ComponentProps<typeof DataEditor>["drawHeader"]>>[0]) => {
      const { ctx, theme, rect, columnIndex, isSelected } = args;
      const cs = columnSettings[columnIndex];
      const label = columnHeaderLabel(cs, columnIndex);
      const badge = columnHeaderRefBadge(cs, columnIndex);
      const isNum = isNumericColumnType(colTypes[columnIndex]);
      const align = isNum ? "right" : undefined;
      const pad = theme.cellHorizontalPadding + 0.5;
      const headerFont = `${theme.headerFontStyle} ${theme.fontFamily}`;
      const bias = getMiddleCenterBias(ctx, headerFont);
      const labelColor = isSelected ? gridThemeTokens.textHeaderSelected : theme.textHeader;

      ctx.save();
      if (isSelected) {
        ctx.fillStyle = gridThemeTokens.accentLight;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      drawAlignedHeaderText(ctx, rect, theme, label, labelColor, align);

      if (badge) {
        const labelW = measurePretextWidth(label, HEADER_FONT);
        ctx.font = HEADER_BADGE_FONT;
        const bw = measurePretextWidth(badge, HEADER_BADGE_FONT) + HEADER_BADGE_H_PAD;
        const bh = 14;
        const by = rect.y + (rect.height - bh) / 2;
        const bx = isNum
          ? rect.x + rect.width - pad - labelW - HEADER_BADGE_GAP - bw
          : rect.x + pad + labelW + HEADER_BADGE_GAP;
        ctx.fillStyle = gridThemeTokens.accentBadgeBg;
        roundRect(ctx, bx, by, bw, bh, 3);
        ctx.fill();
        ctx.fillStyle = gridThemeTokens.accentBadgeFg;
        ctx.textAlign = "left";
        ctx.fillText(badge, bx + HEADER_BADGE_H_PAD / 2, rect.y + rect.height / 2 + bias);
      }
      ctx.restore();
      return true;
    },
    [colTypes, columnSettings, gridThemeTokens],
  );

  return (
    <SpreadsheetGridProvider
      value={{
        defs,
        columnSettings,
        sheets,
        activeSheetRef,
        cellFormulaEdit: cellFormulaEditRef,
        notifyCellPicking: setCellPicking,
        setCellFormulaDraft,
      }}
    >
      <div
        ref={containerRef}
        className={cn(
          "spreadsheet-grid",
          isPicking && "spreadsheet-grid--picking click-outside-ignore",
        )}
        tabIndex={isPicking ? -1 : undefined}
      >
        <DataEditor
          ref={gridRef}
          getCellContent={getCellContent}
          onCellEdited={onCellEdited}
          columns={columns}
          rows={rowCount}
          onColumnResize={handleColumnResize}
          rowMarkers={{ kind: "clickable-number", startIndex: 1 + viewOffset }}
          rowSelect="multi"
          columnSelect="multi"
          smoothScrollX
          smoothScrollY
          width="100%"
          height="100%"
          gridSelection={gridSel}
          onGridSelectionChange={onGridSelectionChange}
          onCellClicked={onCellClicked}
          isOutsideClick={isOutsideClick}
          highlightRegions={highlightRegions}
          provideEditor={provideEditor}
          drawHeader={drawHeader}
          drawCell={drawCell}
          getCellsForSelection
          keybindings={{ search: false }}
          onVisibleRegionChanged={bumpLayout}
          theme={{
            baseFontStyle: "13px",
            headerFontStyle: "600 13px",
            fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
            ...glideTheme,
          }}
        />
        {cellPicking ? (
          <div ref={pickShieldRef} className="spreadsheet-grid__pick-shield" aria-hidden />
        ) : null}
        <SpreadsheetGridInsertControls
          gridRef={gridRef}
          containerRef={containerRef}
          colCount={colCount}
          rowCount={rowCount}
          columnWidths={resolvedColumnWidths}
          layoutEpoch={layoutEpoch}
          addRowLabel={addRowLabel}
          addColumnLabel={addColumnLabel}
          onAddRow={onAddRow}
          onAddColumn={onAddColumn}
        />
      </div>
    </SpreadsheetGridProvider>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// In-cell editor with formula tokens + autocomplete. Glide injects this with
// { value, onChange, onFinishedEditing, target }; defs/columnSettings come from
// the React context provided by the grid.
function FormulaCellEditor(props: {
  value: GridCell;
  onChange: (n: GridCell) => void;
  onFinishedEditing: (newValue?: GridCell, movement?: readonly [number, number]) => void;
  target: Rectangle;
}) {
  const { value, onChange, onFinishedEditing } = props;
  const { defs, columnSettings, sheets, cellFormulaEdit, notifyCellPicking, setCellFormulaDraft } =
    useSpreadsheetGridContext();
  const initial = (value.kind === GridCellKind.Text ? (value as { data?: string }).data : "") ?? "";
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState<string>(initial);
  const [caret, setCaret] = useState(initial.length);
  const insertedLenRef = useRef(0);
  const [idx, setIdx] = useState(0);
  const [popupPos, setPopupPos] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );
  const ignoreMousePick = useRef(false);
  const skipCommit = useRef(false);

  const cellPicking = isOpenFormulaContext(raw, caret);

  useEffect(() => {
    notifyCellPicking(cellPicking);
    return () => notifyCellPicking(false);
  }, [cellPicking, notifyCellPicking]);

  useEffect(() => {
    if (!cellPicking) insertedLenRef.current = 0;
  }, [cellPicking]);

  const applyDraft = useCallback(
    (next: string, nextCaret: number) => {
      setRaw(next);
      setCaret(nextCaret);
      setCellFormulaDraft(next);
      onChange({
        ...(value as { kind: GridCellKind.Text }),
        data: next,
        displayData: next,
      } as GridCell);
    },
    [onChange, setCellFormulaDraft, value],
  );

  const insertRef = useCallback(
    (ref: string) => {
      const safeCaret = Math.min(caret, raw.length);
      const before = raw.slice(0, safeCaret - insertedLenRef.current);
      const after = raw.slice(safeCaret);
      const next = before + ref + after;
      const newCaret = before.length + ref.length;
      insertedLenRef.current = ref.length;
      applyDraft(next, newCaret);
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.setSelectionRange(newCaret, newCaret);
      });
    },
    [applyDraft, caret, raw],
  );

  useEffect(() => {
    cellFormulaEdit.current = {
      draft: raw,
      caret,
      insertedLen: insertedLenRef.current,
      setDraft: applyDraft,
      insertRef,
    };
    return () => {
      cellFormulaEdit.current = null;
    };
  }, [applyDraft, caret, cellFormulaEdit, insertRef, raw]);

  useEffect(() => {
    setCellFormulaDraft(initial);
    return () => setCellFormulaDraft("");
  }, [initial, setCellFormulaDraft]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const suggestions = useMemo(
    () => computeSuggestions(raw, caret, defs, columnSettings, sheets),
    [raw, caret, defs, columnSettings, sheets],
  );
  useEffect(() => setIdx(0), [suggestions.length]);

  useLayoutEffect(() => {
    if (suggestions.length === 0 || idx < 0) {
      setPopupPos(null);
      return;
    }
    const update = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopupPos({ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 320) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [idx, suggestions.length, raw, caret]);

  const refs = useMemo(
    () => new Set(columnSettings.filter((c) => c.ref).map((c) => c.ref!)),
    [columnSettings],
  );
  const { consts, mappingDefs } = useMemo(() => buildFormulaDefContext(defs), [defs]);
  const { sheetRefs, sheetColumnRefs } = useMemo(() => buildFormulaSheetContext(sheets), [sheets]);

  const commit = (text: string) => {
    applyDraft(text, text.length);
  };

  const applySuggestion = (i: number) => {
    const s = suggestions[i];
    if (!s) return;
    const before = raw.slice(0, caret - s.tokenLen);
    const after = raw.slice(caret);
    const next = before + s.insert + after;
    const newCaret = before.length + s.insert.length;
    setRaw(next);
    commit(next);
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.setSelectionRange(newCaret, newCaret);
      setCaret(newCaret);
    });
  };

  const pickFromEvent = (e: React.SyntheticEvent<HTMLElement>) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-suggestion-index]");
    const pick = button?.dataset.suggestionIndex;
    if (pick != null) applySuggestion(Number(pick));
  };

  const isFormula = raw.startsWith("=");

  return (
    <div
      ref={wrapRef}
      className="spreadsheet-cell-editor"
      style={{
        minWidth: Math.max(props.target.width, 280),
        minHeight: Math.max(props.target.height, 28),
      }}
    >
      <FormulaTokens
        value={raw}
        consts={consts}
        refs={refs}
        sheetRefs={sheetRefs}
        sheetColumnRefs={sheetColumnRefs}
        mappingDefs={mappingDefs}
        className="spreadsheet-cell-editor__tokens"
      />

      <input
        ref={inputRef}
        value={raw}
        onChange={(e) => {
          insertedLenRef.current = 0;
          setRaw(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
          commit(e.target.value);
        }}
        onClick={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
        onKeyUp={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (cellPicking && /^Arrow(Up|Down|Left|Right)$/.test(e.key)) {
            // Grid container handles arrow picking while the in-cell editor is open.
            return;
          }
          if (suggestions.length > 0 && idx >= 0 && !cellPicking) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              e.stopPropagation();
              setIdx((i) => (i + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              e.stopPropagation();
              setIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Tab" || e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              applySuggestion(idx);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setIdx(-1);
              return;
            }
          }
          const finish = (movement: readonly [number, number]) => {
            const next = {
              ...(value as { kind: GridCellKind.Text }),
              data: raw,
              displayData: raw,
            } as GridCell;
            onFinishedEditing(next, movement);
          };
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            finish([0, 1]);
            return;
          }
          if (e.key === "Tab") {
            e.preventDefault();
            e.stopPropagation();
            finish([e.shiftKey ? -1 : 1, 0]);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            skipCommit.current = true;
            onFinishedEditing();
          }
        }}
        className={cn(
          "spreadsheet-cell-editor__input",
          isFormula && "spreadsheet-cell-editor__input--formula",
        )}
        spellCheck={false}
      />
      {suggestions.length > 0 &&
        idx >= 0 &&
        popupPos &&
        createPortal(
          <div
            className="spreadsheet-cell-editor__popup"
            style={{ left: popupPos.left, top: popupPos.top, width: popupPos.width }}
            onPointerDownCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
              pickFromEvent(e);
              ignoreMousePick.current = true;
              window.setTimeout(() => {
                ignoreMousePick.current = false;
              }, 0);
            }}
            onMouseDownCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!ignoreMousePick.current) pickFromEvent(e);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <SuggestionList
              suggestions={suggestions}
              activeIdx={idx}
              onPick={applySuggestion}
              onHover={setIdx}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
