import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { parentAndName } from "@/lib/files/api-path";
import { joinFileNameForRename, splitFileNameForRename } from "@/lib/files/filename-rename";
import {
  mergeSpreadsheetLabels,
  type SpreadsheetUILabels,
} from "@/spreadsheet-core/src/spreadsheet-labels";
import type {
  SpreadsheetAPIOperations,
  SpreadsheetDocument,
} from "@/spreadsheet-core/src/spreadsheet-types";
import {
  colLetter,
  createDefaultSheet,
  DEFAULT_EMPTY_YCSV,
  matrixToSheet,
  parseYcsv,
  serializeYcsv,
  sheetToMatrix,
  type ColumnSetting,
  type Defs,
  type ParsedSheet,
  type ParsedWorkbook,
} from "@/spreadsheet-core/src/ycsv/ycsv";
import {
  cellRefFor,
  isOpenFormulaContext,
  moveCellPoint,
  rangeRefFor,
  sheetRefBeforeCaret,
  withSheetPrefix,
  type CellPoint,
} from "@/spreadsheet-core/src/formula-ref-pick";
import type { SpreadsheetGridSelection } from "@/spreadsheet-core/src/spreadsheet-grid";
import { evaluateWorkbook } from "@/spreadsheet-core/src/ycsv/ycsv-formula-engine";
import {
  selectionInfoFromGridSelection,
  cellsInGridSelection,
} from "@/spreadsheet-core/src/spreadsheet-selection-info";
import {
  applyStyleToSheet,
  selectionStyleState,
  toggleBooleanStyle,
} from "@/spreadsheet-core/src/spreadsheet-cell-styles";
import {
  appendAutoColumnWidth,
  computeAutoColumnWidth,
  computeAutoColumnWidths,
  refreshAutoColumnWidths,
  resolveSheetColumnWidths,
  type SheetColumnWidthState,
} from "@/spreadsheet-core/src/spreadsheet-column-widths";
import {
  extractSheetLocalDefs,
  mergeSheetDefs,
} from "@/spreadsheet-core/src/spreadsheet-defs-utils";
import {
  captureSpreadsheetSnapshot,
  popSpreadsheetRedo,
  popSpreadsheetUndo,
  pushSpreadsheetHistory,
  type SpreadsheetHistorySnapshot,
} from "@/spreadsheet-core/src/spreadsheet-history";

const SAVE_DEBOUNCE_MS = 2500;
const CELL_HISTORY_DEBOUNCE_MS = 800;
const SOURCE_HISTORY_DEBOUNCE_MS = 800;
const COLUMN_RESIZE_HISTORY_DEBOUNCE_MS = 500;
const AUTO_SAVE_TOAST_DEBOUNCE_MS = 1200;
const AUTO_SAVE_TOAST_THROTTLE_MS = 8000;

const EMPTY_YCSV = DEFAULT_EMPTY_YCSV;

type UseSpreadsheetControllerArgs = {
  filePath: string | null;
  labels?: Partial<SpreadsheetUILabels>;
  operations?: SpreadsheetAPIOperations;
  /** Mock bootstrap document when no `filePath` (Storybook). */
  initialDocument?: SpreadsheetDocument | null;
  onFileRenamed?: (apiPath: string) => void;
};

function fileNameFromApiPath(apiPath: string): string {
  return parentAndName(apiPath).from;
}

function resolveActiveApiPath(
  filePath: string | null,
  document: SpreadsheetDocument | null,
  initialDocument: SpreadsheetDocument | null,
): string | null {
  return filePath ?? document?.apiPath ?? initialDocument?.apiPath ?? null;
}

/** Rebuild a workbook with the active sheet's rows replaced from a matrix. */
function workbookWithSheetMatrix(
  workbook: ParsedWorkbook,
  sheetIndex: number,
  matrix: { value?: string }[][],
): ParsedWorkbook {
  const { rows } = matrixToSheet(matrix, { trimTrailingBlankRows: false });
  const sheets = workbook.sheets.map((sheet, i) => (i === sheetIndex ? { ...sheet, rows } : sheet));
  return { ...workbook, sheets };
}

function workbookWithActiveSheet(
  workbook: ParsedWorkbook,
  sheetIndex: number,
  nextSheet: ParsedSheet,
): ParsedWorkbook {
  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet, i) => (i === sheetIndex ? nextSheet : sheet)),
  };
}

function sheetWithColumnSettings(sheet: ParsedSheet, columnSettings: ColumnSetting[]): ParsedSheet {
  const colCount = columnSettings.length;
  const refs = columnSettings.map((column, index) => column.ref ?? colLetter(index));
  const headers = columnSettings.map(
    (column, index) => column.name ?? column.ref ?? colLetter(index),
  );
  const rows = sheet.rows.map((row) => {
    const next = row.slice(0, colCount);
    while (next.length < colCount) next.push("");
    return next;
  });
  return { ...sheet, columnSettings, refs, headers, rows };
}

function sheetWithMergedDefs(
  sheet: ParsedSheet,
  workbookDefs: Defs,
  sheetLocalDefs: Defs,
): ParsedSheet {
  return { ...sheet, defs: mergeSheetDefs(workbookDefs, sheetLocalDefs) };
}

function nextSheetRef(sheets: ParsedSheet[]): string {
  const used = new Set(sheets.map((sheet) => sheet.ref));
  let n = 1;
  while (used.has(`sheet${n}`)) n++;
  return `sheet${n}`;
}

export function useSpreadsheetController({
  filePath,
  labels,
  operations,
  initialDocument = null,
  onFileRenamed,
}: UseSpreadsheetControllerArgs) {
  const L = useMemo(() => mergeSpreadsheetLabels(labels), [labels]);
  const { show, showError } = useAppToast();
  const { confirmDialog, requestConfirm } = useConfirmDialog({
    contentClassName: "spreadsheet-dialog-surface",
  });

  const [document, setDocument] = useState<SpreadsheetDocument | null>(initialDocument);
  const [source, setSource] = useState(() => initialDocument?.content ?? EMPTY_YCSV);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [activeCell, setActiveCell] = useState<{ row: number; column: number } | null>(null);
  const [selection, setSelection] = useState<SpreadsheetGridSelection>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [schemaPanelOpen, setSchemaPanelOpen] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingContentRef = useRef<string | null>(null);
  const autoSaveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSaveToastAtRef = useRef(0);
  const latestPathRef = useRef<string | null>(
    resolveActiveApiPath(filePath, null, initialDocument),
  );

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameExtension, setRenameExtension] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [sheetRenameDialog, setSheetRenameDialog] = useState<null | {
    index: number;
    name: string;
  }>(null);
  /** Preserves structural edits (e.g. trailing empty rows) that YCSV re-parse would drop. */
  const [workbookOverride, setWorkbookOverride] = useState<ParsedWorkbook | null>(null);
  const [columnWidthsBySheet, setColumnWidthsBySheet] = useState<
    Record<string, SheetColumnWidthState>
  >({});
  const [undoStack, setUndoStack] = useState<SpreadsheetHistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<SpreadsheetHistorySnapshot[]>([]);

  const historyStateRef = useRef({
    source,
    workbookOverride,
    activeSheetIndex,
    activeCell,
    selection,
    columnWidthsBySheet,
  });
  const cellHistoryArmedRef = useRef(false);
  const cellHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceHistoryArmedRef = useRef(false);
  const sourceHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const columnResizeHistoryArmedRef = useRef(false);
  const columnResizeHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    historyStateRef.current = {
      source,
      workbookOverride,
      activeSheetIndex,
      activeCell,
      selection,
      columnWidthsBySheet,
    };
  }, [activeCell, activeSheetIndex, columnWidthsBySheet, selection, source, workbookOverride]);

  const clearHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
    cellHistoryArmedRef.current = false;
    sourceHistoryArmedRef.current = false;
    columnResizeHistoryArmedRef.current = false;
    if (cellHistoryTimerRef.current) {
      clearTimeout(cellHistoryTimerRef.current);
      cellHistoryTimerRef.current = null;
    }
    if (sourceHistoryTimerRef.current) {
      clearTimeout(sourceHistoryTimerRef.current);
      sourceHistoryTimerRef.current = null;
    }
    if (columnResizeHistoryTimerRef.current) {
      clearTimeout(columnResizeHistoryTimerRef.current);
      columnResizeHistoryTimerRef.current = null;
    }
  }, []);

  const pushHistory = useCallback(() => {
    const snapshot = captureSpreadsheetSnapshot(historyStateRef.current);
    setUndoStack((current) => pushSpreadsheetHistory(current, snapshot));
    setRedoStack([]);
  }, []);

  const pushDebouncedHistory = useCallback(
    (
      armedRef: { current: boolean },
      timerRef: { current: ReturnType<typeof setTimeout> | null },
      debounceMs: number,
    ) => {
      if (!armedRef.current) {
        pushHistory();
        armedRef.current = true;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        armedRef.current = false;
        timerRef.current = null;
      }, debounceMs);
    },
    [pushHistory],
  );

  const workbookFromSource = useMemo<ParsedWorkbook>(() => {
    try {
      return parseYcsv(source);
    } catch {
      return parseYcsv(EMPTY_YCSV);
    }
  }, [source]);

  const workbook = workbookOverride ?? workbookFromSource;

  const computed = useMemo(() => {
    try {
      return evaluateWorkbook(workbook);
    } catch {
      return workbook.sheets.map(() => []);
    }
  }, [workbook]);

  const sheetCount = workbook.sheets.length;
  const safeSheetIndex = Math.min(activeSheetIndex, Math.max(0, sheetCount - 1));
  const activeSheet = workbook.sheets[safeSheetIndex];

  const rawData = useMemo(() => (activeSheet ? sheetToMatrix(activeSheet) : [[]]), [activeSheet]);
  const activeComputed = computed[safeSheetIndex] ?? [];
  const columnSettings = useMemo<ColumnSetting[]>(
    () => activeSheet?.columnSettings ?? [],
    [activeSheet],
  );
  const defs = useMemo<Defs>(() => activeSheet?.defs ?? {}, [activeSheet]);

  const sheetWidthKey = activeSheet?.ref ?? `sheet-${safeSheetIndex}`;

  const autoColumnWidths = useMemo(
    () =>
      computeAutoColumnWidths(columnSettings.length, columnSettings, rawData, activeComputed, 1),
    [activeComputed, columnSettings, rawData],
  );

  const columnWidths = useMemo(
    () =>
      resolveSheetColumnWidths(
        columnSettings.length,
        autoColumnWidths,
        columnWidthsBySheet[sheetWidthKey],
      ),
    [autoColumnWidths, columnSettings.length, columnWidthsBySheet, sheetWidthKey],
  );

  useEffect(() => {
    setColumnWidthsBySheet((prev) => {
      if (prev[sheetWidthKey]) return prev;
      return {
        ...prev,
        [sheetWidthKey]: {
          widths: autoColumnWidths,
          manualCols: new Set(),
        },
      };
    });
  }, [autoColumnWidths, sheetWidthKey]);

  useEffect(() => {
    setColumnWidthsBySheet((prev) => {
      const current = prev[sheetWidthKey];
      if (!current) return prev;
      const next = refreshAutoColumnWidths(current, autoColumnWidths);
      if (next.widths.every((w, i) => w === current.widths[i])) return prev;
      return { ...prev, [sheetWidthKey]: next };
    });
  }, [autoColumnWidths, sheetWidthKey]);

  const queueAutoSaveToast = useCallback(() => {
    if (autoSaveToastTimerRef.current) clearTimeout(autoSaveToastTimerRef.current);
    autoSaveToastTimerRef.current = setTimeout(() => {
      const now = Date.now();
      if (now - lastAutoSaveToastAtRef.current < AUTO_SAVE_TOAST_THROTTLE_MS) {
        autoSaveToastTimerRef.current = null;
        return;
      }
      lastAutoSaveToastAtRef.current = now;
      show(L.toastSaved, { icon: <Check className="size-4" /> });
      autoSaveToastTimerRef.current = null;
    }, AUTO_SAVE_TOAST_DEBOUNCE_MS);
  }, [L.toastSaved, show]);

  const flushSave = useCallback(async () => {
    const path = latestPathRef.current;
    const nextContent = pendingContentRef.current;
    if (!path || nextContent == null || !operations || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    pendingContentRef.current = null;
    try {
      await operations.saveFile(path, nextContent);
      queueAutoSaveToast();
    } catch {
      showError(L.saveError);
      pendingContentRef.current = nextContent;
    } finally {
      saveInFlightRef.current = false;
      if (pendingContentRef.current != null) void flushSave();
    }
  }, [L.saveError, operations, queueAutoSaveToast, showError]);

  const scheduleSave = useCallback(
    (nextContent: string) => {
      if (!latestPathRef.current || !operations) return;
      pendingContentRef.current = nextContent;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave, operations],
  );

  useEffect(() => {
    latestPathRef.current = resolveActiveApiPath(filePath, document, initialDocument);
  }, [document, filePath, initialDocument]);

  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingContentRef.current = null;
    setActiveSheetIndex(0);
    setActiveCell(null);
    setSelection(null);
    setParseError(null);
    setWorkbookOverride(null);
    setColumnWidthsBySheet({});
    clearHistory();

    if (!filePath) {
      setDocument(initialDocument);
      setSource(initialDocument?.content ?? EMPTY_YCSV);
      setLoadError(false);
      setLoading(false);
      return;
    }
    if (!operations) {
      setDocument(null);
      setSource(EMPTY_YCSV);
      setLoadError(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void operations
      .loadFile(filePath)
      .then((loaded) => {
        if (cancelled) return;
        const content = loaded.trim() ? loaded : EMPTY_YCSV;
        setDocument({
          apiPath: filePath,
          fileName: fileNameFromApiPath(filePath),
          content,
        });
        setSource(content);
      })
      .catch(() => {
        if (cancelled) return;
        setDocument(null);
        setSource(EMPTY_YCSV);
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, initialDocument, operations, clearHistory]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (autoSaveToastTimerRef.current) clearTimeout(autoSaveToastTimerRef.current);
      if (cellHistoryTimerRef.current) clearTimeout(cellHistoryTimerRef.current);
      if (sourceHistoryTimerRef.current) clearTimeout(sourceHistoryTimerRef.current);
      if (columnResizeHistoryTimerRef.current) clearTimeout(columnResizeHistoryTimerRef.current);
      const pending = pendingContentRef.current;
      if (pending != null && latestPathRef.current && operations) {
        void operations.saveFile(latestPathRef.current, pending).catch(() => {});
      }
    },
    [operations],
  );

  // Apply a new source string (from grid edits or the source editor) + autosave.
  const applySource = useCallback(
    (next: string) => {
      setSource(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  type WorkbookUndoMode = "immediate" | "debounced" | "none";

  const applyWorkbookChange = useCallback(
    (nextWorkbook: ParsedWorkbook, undoMode: WorkbookUndoMode = "immediate") => {
      if (undoMode === "immediate") pushHistory();
      else if (undoMode === "debounced") {
        pushDebouncedHistory(cellHistoryArmedRef, cellHistoryTimerRef, CELL_HISTORY_DEBOUNCE_MS);
      }
      setWorkbookOverride(nextWorkbook);
      applySource(serializeYcsv(nextWorkbook));
    },
    [applySource, pushDebouncedHistory, pushHistory],
  );

  const writeCell = useCallback(
    (row: number, column: number, value: string, undoMode: WorkbookUndoMode = "debounced") => {
      if (!activeSheet) return;
      const matrix = sheetToMatrix(activeSheet).map((r) => r.map((c) => ({ value: c.value })));
      while (matrix.length <= row) {
        matrix.push(matrix[0]?.map(() => ({ value: "" })) ?? [{ value: "" }]);
      }
      const targetRow = matrix[row];
      while (targetRow.length <= column) targetRow.push({ value: "" });
      targetRow[column] = { value };
      const nextWorkbook = workbookWithSheetMatrix(workbook, safeSheetIndex, matrix);
      applyWorkbookChange(nextWorkbook, undoMode);
    },
    [activeSheet, applyWorkbookChange, safeSheetIndex, workbook],
  );

  const clearSelection = useCallback((): boolean => {
    if (!activeSheet) return false;
    const targetSelection =
      selection ??
      (activeCell
        ? ({ kind: "cell", row: activeCell.row, column: activeCell.column } as const)
        : null);
    if (!targetSelection) return false;

    const points = cellsInGridSelection(targetSelection, columnSettings.length, rawData.length, 1);
    if (!points.length) return false;

    const matrix = sheetToMatrix(activeSheet).map((r) => r.map((c) => ({ value: c.value ?? "" })));
    let changed = false;
    for (const { row, column } of points) {
      if (row < 0 || column < 0) continue;
      while (matrix.length <= row) {
        matrix.push(matrix[0]?.map(() => ({ value: "" })) ?? [{ value: "" }]);
      }
      const targetRow = matrix[row];
      while (targetRow.length <= column) targetRow.push({ value: "" });
      if ((targetRow[column]?.value ?? "") !== "") {
        targetRow[column] = { value: "" };
        changed = true;
      }
    }
    if (!changed) return false;

    const nextWorkbook = workbookWithSheetMatrix(workbook, safeSheetIndex, matrix);
    applyWorkbookChange(nextWorkbook, "immediate");
    return true;
  }, [
    activeCell,
    activeSheet,
    applyWorkbookChange,
    columnSettings.length,
    rawData.length,
    safeSheetIndex,
    selection,
    workbook,
  ]);

  const addRow = useCallback(() => {
    if (!activeSheet) return;
    const colLen = Math.max(1, activeSheet.columnSettings.length);
    const emptyRow = Array.from({ length: colLen }, () => "");
    const nextSheet: ParsedSheet = { ...activeSheet, rows: [...activeSheet.rows, emptyRow] };
    applyWorkbookChange(workbookWithActiveSheet(workbook, safeSheetIndex, nextSheet));
  }, [activeSheet, applyWorkbookChange, safeSheetIndex, workbook]);

  const addColumn = useCallback(() => {
    if (!activeSheet) return;
    const nextCol = activeSheet.columnSettings.length;
    const ref = colLetter(nextCol);
    const nextColumnSettings: ColumnSetting[] = [
      ...activeSheet.columnSettings,
      { ref, name: ref, refExplicit: false },
    ];
    const nextSheet: ParsedSheet = {
      ...activeSheet,
      rows: activeSheet.rows.map((row) => [...row, ""]),
      columnSettings: nextColumnSettings,
      refs: nextColumnSettings.map((c) => c.ref!),
      headers: nextColumnSettings.map((c) => c.name ?? c.ref!),
    };
    const nextMatrix = sheetToMatrix(nextSheet);
    const nextComputed = evaluateWorkbook(
      workbookWithActiveSheet(workbook, safeSheetIndex, nextSheet),
    )[safeSheetIndex];
    const newWidth = computeAutoColumnWidth(
      nextCol,
      nextColumnSettings,
      nextMatrix,
      nextComputed ?? [],
      1,
    );
    setColumnWidthsBySheet((prev) => ({
      ...prev,
      [sheetWidthKey]: appendAutoColumnWidth(prev[sheetWidthKey], newWidth),
    }));
    applyWorkbookChange(workbookWithActiveSheet(workbook, safeSheetIndex, nextSheet));
  }, [activeSheet, applyWorkbookChange, safeSheetIndex, sheetWidthKey, workbook]);

  const setColumnWidth = useCallback(
    (column: number, width: number) => {
      pushDebouncedHistory(
        columnResizeHistoryArmedRef,
        columnResizeHistoryTimerRef,
        COLUMN_RESIZE_HISTORY_DEBOUNCE_MS,
      );
      setColumnWidthsBySheet((prev) => {
        const current = prev[sheetWidthKey] ?? {
          widths: [...autoColumnWidths],
          manualCols: new Set<number>(),
        };
        const widths = [...current.widths];
        while (widths.length <= column) widths.push(width);
        widths[column] = width;
        const manualCols = new Set(current.manualCols);
        manualCols.add(column);
        return { ...prev, [sheetWidthKey]: { widths, manualCols } };
      });
    },
    [autoColumnWidths, pushDebouncedHistory, sheetWidthKey],
  );

  const updateDefs = useCallback(
    (nextWorkbookDefs: Defs, nextSheetLocalDefs: Defs) => {
      if (!activeSheet) return;
      applyWorkbookChange(
        {
          ...workbook,
          defs: nextWorkbookDefs,
          sheets: workbook.sheets.map((sheet, index) => {
            const localDefs =
              index === safeSheetIndex
                ? nextSheetLocalDefs
                : extractSheetLocalDefs(sheet.defs, workbook.defs);
            return sheetWithMergedDefs(sheet, nextWorkbookDefs, localDefs);
          }),
        },
        "debounced",
      );
    },
    [activeSheet, applyWorkbookChange, safeSheetIndex, workbook],
  );

  const updateColumnSettings = useCallback(
    (nextColumnSettings: ColumnSetting[]) => {
      if (!activeSheet) return;
      const nextSheet = sheetWithColumnSettings(activeSheet, nextColumnSettings);
      const nextMatrix = sheetToMatrix(nextSheet);
      const nextComputed = evaluateWorkbook(
        workbookWithActiveSheet(workbook, safeSheetIndex, nextSheet),
      )[safeSheetIndex];
      const nextAutoWidths = computeAutoColumnWidths(
        nextColumnSettings.length,
        nextColumnSettings,
        nextMatrix,
        nextComputed ?? [],
        1,
      );
      setColumnWidthsBySheet((prev) => ({
        ...prev,
        [sheetWidthKey]: {
          widths: nextAutoWidths,
          manualCols: new Set<number>(),
        },
      }));
      applyWorkbookChange(
        workbookWithActiveSheet(workbook, safeSheetIndex, nextSheet),
        "debounced",
      );
    },
    [activeSheet, applyWorkbookChange, safeSheetIndex, sheetWidthKey, workbook],
  );

  const addSheet = useCallback(() => {
    const ref = nextSheetRef(workbook.sheets);
    const nextSheet = createDefaultSheet(ref);
    const nextIndex = workbook.sheets.length;
    applyWorkbookChange({
      ...workbook,
      sheets: [...workbook.sheets, nextSheet],
    });
    setActiveSheetIndex(nextIndex);
    setActiveCell(null);
    setSelection(null);
    show(L.toastSheetCreated(ref), { icon: <Check className="size-4" /> });
  }, [L.toastSheetCreated, applyWorkbookChange, show, workbook]);

  const openSheetRenameDialog = useCallback(
    (index: number) => {
      const sheet = workbook.sheets[index];
      if (!sheet) return;
      setSheetRenameDialog({ index, name: sheet.name || sheet.ref });
    },
    [workbook.sheets],
  );

  const closeSheetRenameDialog = useCallback(() => {
    setSheetRenameDialog(null);
  }, []);

  const renameSheet = useCallback(
    (index: number, name: string) => {
      const sheet = workbook.sheets[index];
      const trimmed = name.trim();
      if (!sheet || !trimmed || trimmed === (sheet.name || sheet.ref)) return;
      const nextSheet: ParsedSheet = { ...sheet, name: trimmed };
      applyWorkbookChange(workbookWithActiveSheet(workbook, index, nextSheet));
      show(L.toastSheetRenamed(trimmed), { icon: <Pencil className="size-4" /> });
    },
    [L.toastSheetRenamed, applyWorkbookChange, show, workbook],
  );

  const deleteSheet = useCallback(
    (index: number) => {
      if (workbook.sheets.length <= 1) return;
      const deletedRef = workbook.sheets[index]?.ref;
      const nextSheets = workbook.sheets.filter((_, i) => i !== index);
      applyWorkbookChange({ ...workbook, sheets: nextSheets });
      if (deletedRef) {
        setColumnWidthsBySheet((prev) => {
          if (!prev[deletedRef]) return prev;
          const next = { ...prev };
          delete next[deletedRef];
          return next;
        });
      }
      setActiveSheetIndex((current) => {
        if (index < current) return current - 1;
        if (index === current) return Math.min(current, nextSheets.length - 1);
        return current;
      });
      setActiveCell(null);
      setSelection(null);
    },
    [applyWorkbookChange, workbook],
  );

  const requestDeleteSheet = useCallback(
    (index: number) => {
      if (workbook.sheets.length <= 1) return;
      const sheet = workbook.sheets[index];
      if (!sheet) return;
      const displayName = sheet.name || sheet.ref;
      requestConfirm({
        title: L.deleteSheetTitle,
        description: L.deleteSheetDescription(displayName),
        confirmLabel: L.deleteSheetConfirm,
        cancelLabel: L.cancel,
        variant: "destructive",
        onConfirm: () => deleteSheet(index),
      });
    },
    [
      L.cancel,
      L.deleteSheetConfirm,
      L.deleteSheetDescription,
      L.deleteSheetTitle,
      deleteSheet,
      requestConfirm,
      workbook.sheets,
    ],
  );

  const onSourceChange = useCallback(
    (next: string) => {
      pushDebouncedHistory(
        sourceHistoryArmedRef,
        sourceHistoryTimerRef,
        SOURCE_HISTORY_DEBOUNCE_MS,
      );
      setWorkbookOverride(null);
      setColumnWidthsBySheet((prev) => {
        if (!prev[sheetWidthKey]) return prev;
        const nextState = { ...prev };
        delete nextState[sheetWidthKey];
        return nextState;
      });
      try {
        const parsed = parseYcsv(next);
        setParseError(parsed.warnings.find((w) => w.includes("not valid YAML")) ?? null);
      } catch {
        setParseError(L.parseError);
      }
      applySource(next);
    },
    [L.parseError, applySource, pushDebouncedHistory, sheetWidthKey],
  );

  // Formula-bar editing of the active cell.
  const activeRaw =
    activeCell && rawData[activeCell.row]?.[activeCell.column]
      ? (rawData[activeCell.row][activeCell.column].value ?? "")
      : "";

  const [fbEditing, setFbEditing] = useState(false);
  const [fbDraft, setFbDraft] = useState("");
  const [fbCaret, setFbCaret] = useState(0);
  const insertedRangeLenRef = useRef(0);
  const pickKeyboardAnchorRef = useRef<CellPoint | null>(null);

  const beginFormulaEdit = useCallback(() => {
    setFbDraft(activeRaw);
    setFbCaret(activeRaw.length);
    setFbEditing(true);
    insertedRangeLenRef.current = 0;
    pickKeyboardAnchorRef.current = null;
  }, [activeRaw]);

  const cancelFormulaEdit = useCallback(() => {
    setFbEditing(false);
    setFbDraft("");
    insertedRangeLenRef.current = 0;
    pickKeyboardAnchorRef.current = null;
  }, []);

  const commitFormulaBar = useCallback(
    (value: string) => {
      setFbEditing(false);
      setFbDraft("");
      if (!activeCell) return;
      writeCell(activeCell.row, activeCell.column, value, "immediate");
    },
    [activeCell, writeCell],
  );

  const applySnapshot = useCallback(
    (snapshot: SpreadsheetHistorySnapshot) => {
      setWorkbookOverride(snapshot.workbookOverride);
      setSource(snapshot.source);
      setActiveSheetIndex(snapshot.activeSheetIndex);
      setActiveCell(snapshot.activeCell);
      setSelection(snapshot.selection);
      setColumnWidthsBySheet(snapshot.columnWidthsBySheet);
      setFbEditing(false);
      setFbDraft("");
      try {
        const parsed = parseYcsv(snapshot.source);
        setParseError(parsed.warnings.find((w) => w.includes("not valid YAML")) ?? null);
      } catch {
        setParseError(L.parseError);
      }
      scheduleSave(snapshot.source);
    },
    [L.parseError, scheduleSave],
  );

  const undo = useCallback(() => {
    const popped = popSpreadsheetUndo(undoStack);
    if (!popped) return false;
    const current = captureSpreadsheetSnapshot(historyStateRef.current);
    setUndoStack(popped.undo);
    setRedoStack((currentRedo) => pushSpreadsheetHistory(currentRedo, current));
    applySnapshot(popped.snapshot);
    return true;
  }, [applySnapshot, undoStack]);

  const redo = useCallback(() => {
    const popped = popSpreadsheetRedo(redoStack);
    if (!popped) return false;
    const current = captureSpreadsheetSnapshot(historyStateRef.current);
    setRedoStack(popped.redo);
    setUndoStack((currentUndo) => pushSpreadsheetHistory(currentUndo, current));
    applySnapshot(popped.snapshot);
    return true;
  }, [applySnapshot, redoStack]);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const activeSheetRef = activeSheet?.ref ?? "";

  // Picking mode: editing a formula whose caret sits in an "open" reference slot.
  const picking = fbEditing && isOpenFormulaContext(fbDraft, fbCaret);

  const formatPickedRef = useCallback(
    (row: number, column: number, sheetRef = activeSheetRef, cols = columnSettings): string => {
      const bare = cellRefFor(row, column, cols);
      const contextSheet = sheetRefBeforeCaret(fbDraft, fbCaret);
      return withSheetPrefix(bare, sheetRef, contextSheet, activeSheetRef);
    },
    [activeSheetRef, columnSettings, fbCaret, fbDraft],
  );

  const formatPickedRange = useCallback(
    (
      start: CellPoint,
      end: CellPoint,
      sheetRef = activeSheetRef,
      cols = columnSettings,
    ): string => {
      const bare = rangeRefFor(start, end, cols);
      const contextSheet = sheetRefBeforeCaret(fbDraft, fbCaret);
      return withSheetPrefix(bare, sheetRef, contextSheet, activeSheetRef);
    },
    [activeSheetRef, columnSettings, fbCaret, fbDraft],
  );

  const insertRefAtCaret = useCallback(
    (ref: string) => {
      setFbDraft((prev) => {
        const caret = Math.min(fbCaret, prev.length);
        const before = prev.slice(0, caret - insertedRangeLenRef.current);
        const after = prev.slice(caret);
        const next = before + ref + after;
        const newCaret = before.length + ref.length;
        insertedRangeLenRef.current = ref.length;
        setFbCaret(newCaret);
        return next;
      });
    },
    [fbCaret],
  );

  /** A1 / named ref for a clicked cell, used while picking in the formula bar. */
  const refForCell = useCallback(
    (row: number, column: number) => formatPickedRef(row, column),
    [formatPickedRef],
  );

  const refRangeForSelection = useCallback(
    (sel: Extract<SpreadsheetGridSelection, { kind: "range" }>) =>
      formatPickedRange(sel.start, sel.end),
    [formatPickedRange],
  );

  const onGridSelect = useCallback((sel: SpreadsheetGridSelection) => {
    setSelection(sel);
  }, []);

  const onGridActivate = useCallback(
    (p: { row: number; column: number }) => {
      if (picking) return;
      insertedRangeLenRef.current = 0;
      pickKeyboardAnchorRef.current = null;
      setActiveCell(p);
    },
    [picking],
  );

  const onFormulaDraftChange = useCallback((next: string, caret?: number) => {
    insertedRangeLenRef.current = 0;
    pickKeyboardAnchorRef.current = null;
    setFbDraft(next);
    if (caret != null) setFbCaret(caret);
  }, []);

  const onFormulaCaretChange = useCallback((caret: number) => {
    setFbCaret(caret);
  }, []);

  useEffect(() => {
    if (!fbEditing || !isOpenFormulaContext(fbDraft, fbCaret)) {
      insertedRangeLenRef.current = 0;
      pickKeyboardAnchorRef.current = null;
    }
  }, [fbCaret, fbDraft, fbEditing]);

  const rowCount = activeSheet?.rows.length ?? 0;
  const colCount = columnSettings.length;

  const onPickingArrow = useCallback(
    (key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", extend: boolean) => {
      if (!picking || !activeCell) return;
      const origin = pickKeyboardAnchorRef.current ?? activeCell;
      if (!pickKeyboardAnchorRef.current) pickKeyboardAnchorRef.current = origin;
      const next = moveCellPoint(origin, key, rowCount, colCount);
      pickKeyboardAnchorRef.current = next;
      const ref = extend
        ? formatPickedRange(activeCell, next)
        : formatPickedRef(next.row, next.column);
      insertRefAtCaret(ref);
    },
    [activeCell, colCount, formatPickedRange, formatPickedRef, insertRefAtCaret, picking, rowCount],
  );

  const formulaHighlight = fbEditing ? fbDraft : activeRaw;

  const selectionInfo = useMemo(
    () => selectionInfoFromGridSelection(selection, columnSettings, L),
    [L, columnSettings, selection],
  );

  const selectionStyle = useMemo(
    () => (activeSheet ? selectionStyleState(selection, activeSheet) : null),
    [activeSheet, selection],
  );

  const hasStyleSelection = selection != null;

  const applyStyleToSelection = useCallback(
    (patch: { bold?: boolean; border?: boolean; fill?: string | null }) => {
      if (!activeSheet || !selection) return;
      const stylePatch = {
        ...(patch.bold !== undefined ? { bold: patch.bold } : {}),
        ...(patch.border !== undefined ? { border: patch.border } : {}),
        ...(patch.fill !== undefined ? { fill: patch.fill ?? undefined } : {}),
      };
      const nextSheet = applyStyleToSheet(activeSheet, selection, stylePatch);
      applyWorkbookChange(workbookWithActiveSheet(workbook, safeSheetIndex, nextSheet));
    },
    [activeSheet, applyWorkbookChange, safeSheetIndex, selection, workbook],
  );

  const toggleBoldOnSelection = useCallback(() => {
    if (!selectionStyle) return;
    applyStyleToSelection({ bold: toggleBooleanStyle(selectionStyle.bold) });
  }, [applyStyleToSelection, selectionStyle]);

  const toggleBorderOnSelection = useCallback(() => {
    if (!selectionStyle) return;
    applyStyleToSelection({ border: toggleBooleanStyle(selectionStyle.border) });
  }, [applyStyleToSelection, selectionStyle]);

  const setFillOnSelection = useCallback(
    (fill: string | null) => {
      applyStyleToSelection({ fill });
    },
    [applyStyleToSelection],
  );

  const title = document?.fileName ?? (filePath ? fileNameFromApiPath(filePath) : "");

  const openRenameDialog = useCallback(() => {
    const { baseName, extension, hasExtension } = splitFileNameForRename(title);
    setRenameName(baseName);
    setRenameExtension(hasExtension ? extension : "");
    setRenameDialogOpen(true);
  }, [title]);

  const closeRenameDialog = useCallback(() => {
    if (renamePending) return;
    setRenameDialogOpen(false);
    setRenameName("");
    setRenameExtension("");
  }, [renamePending]);

  const submitRename = useCallback(async () => {
    const path = latestPathRef.current;
    const nextName = renameExtension
      ? joinFileNameForRename(renameName, renameExtension)
      : renameName.trim();
    if (!path || !nextName || nextName === title || !operations?.renameFile) {
      closeRenameDialog();
      return;
    }
    setRenamePending(true);
    try {
      const nextPath = await operations.renameFile(path, nextName);
      setDocument((current) =>
        current ? { ...current, apiPath: nextPath, fileName: nextName } : current,
      );
      latestPathRef.current = nextPath;
      onFileRenamed?.(nextPath);
      show(`Renamed to “${nextName}”`, { icon: <Pencil className="size-4" /> });
      setRenameDialogOpen(false);
      setRenameName("");
      setRenameExtension("");
    } catch {
      showError(L.renameError);
    } finally {
      setRenamePending(false);
    }
  }, [
    closeRenameDialog,
    L.renameError,
    onFileRenamed,
    operations,
    renameExtension,
    renameName,
    show,
    showError,
    title,
  ]);

  return {
    labels: L,
    title,
    loading,
    loadError,
    hasFile: !!filePath || !!initialDocument,
    canRename: Boolean(
      resolveActiveApiPath(filePath, document, initialDocument) && operations?.renameFile,
    ),
    canAddSheet: !!filePath || !!initialDocument,
    source,
    parseError,
    onSourceChange,
    workbook,
    sheets: workbook.sheets,
    activeSheetIndex: safeSheetIndex,
    setActiveSheetIndex,
    // Footer stats for the active sheet: column count and data-row count
    // (YCSV `rows` are the data rows, excluding the header row).
    columnCount: columnSettings.length,
    rowCount: activeSheet?.rows.length ?? 0,
    rawData,
    computed: activeComputed,
    columnSettings,
    defs,
    viewOffset: 1,
    activeCell,
    setActiveCell,
    activeRaw,
    selection,
    setSelection,
    selectionInfo,
    selectionStyle,
    hasStyleSelection,
    applyStyleToSelection,
    toggleBoldOnSelection,
    toggleBorderOnSelection,
    setFillOnSelection,
    writeCell,
    clearSelection,
    addRow,
    addColumn,
    addSheet,
    renameSheet,
    deleteSheet,
    requestDeleteSheet,
    openSheetRenameDialog,
    closeSheetRenameDialog,
    sheetRenameDialog,
    confirmDialog,
    columnWidths,
    setColumnWidth,
    commitFormulaBar,
    refForCell,
    refRangeForSelection,
    fbEditing,
    fbDraft,
    setFbDraft: onFormulaDraftChange,
    fbCaret,
    setFbCaret: onFormulaCaretChange,
    beginFormulaEdit,
    cancelFormulaEdit,
    picking,
    insertRefAtCaret,
    onGridSelect,
    onGridActivate,
    onPickingArrow,
    formulaHighlight,
    activeSheetRef,
    sidebarOpen,
    setSidebarOpen,
    schemaPanelOpen,
    setSchemaPanelOpen,
    updateDefs,
    updateColumnSettings,
    renameDialogOpen,
    renameName,
    setRenameName,
    renameExtension,
    renamePending,
    openRenameDialog,
    closeRenameDialog,
    submitRename,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}

export type SpreadsheetController = ReturnType<typeof useSpreadsheetController>;
