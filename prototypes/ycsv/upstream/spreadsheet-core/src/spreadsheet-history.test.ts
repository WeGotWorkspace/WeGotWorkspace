import { describe, expect, it } from "vitest";
import {
  captureSpreadsheetSnapshot,
  popSpreadsheetRedo,
  popSpreadsheetUndo,
  pushSpreadsheetHistory,
  SPREADSHEET_HISTORY_MAX,
} from "@/spreadsheet-core/src/spreadsheet-history";

const baseSnapshot = () =>
  captureSpreadsheetSnapshot({
    source: "---\nycsv_version: 1\n---\nA\n1",
    workbookOverride: null,
    activeSheetIndex: 0,
    activeCell: { row: 0, column: 0 },
    selection: { kind: "cell", row: 0, column: 0 },
    columnWidthsBySheet: {
      sheet1: { widths: [100, 120], manualCols: new Set([1]) },
    },
  });

describe("spreadsheet-history", () => {
  it("push and pop undo restores prior snapshot", () => {
    const before = baseSnapshot();
    const after = captureSpreadsheetSnapshot({
      ...before,
      source: before.source.replace("1", "2"),
      activeCell: { row: 1, column: 0 },
    });

    const undoStack = pushSpreadsheetHistory([], before);
    expect(undoStack).toHaveLength(1);

    const popped = popSpreadsheetUndo(undoStack);
    expect(popped?.snapshot.source).toBe(before.source);
    expect(popped?.snapshot.activeCell).toEqual({ row: 0, column: 0 });
    expect(popped?.undo).toHaveLength(0);

    const redoStack = pushSpreadsheetHistory([], after);
    const redo = popSpreadsheetRedo(redoStack);
    expect(redo?.snapshot.source).toContain("2");
  });

  it("clones nested state so later mutations do not alias history", () => {
    const snapshot = baseSnapshot();
    const undoStack = pushSpreadsheetHistory([], snapshot);

    snapshot.columnWidthsBySheet.sheet1!.widths[0] = 999;
    snapshot.columnWidthsBySheet.sheet1!.manualCols.add(9);
    snapshot.activeCell!.row = 5;

    expect(undoStack[0]?.columnWidthsBySheet.sheet1?.widths[0]).toBe(100);
    expect(undoStack[0]?.columnWidthsBySheet.sheet1?.manualCols.has(9)).toBe(false);
    expect(undoStack[0]?.activeCell).toEqual({ row: 0, column: 0 });
  });

  it("caps undo depth", () => {
    let stack: ReturnType<typeof baseSnapshot>[] = [];
    for (let i = 0; i < SPREADSHEET_HISTORY_MAX + 5; i++) {
      stack = pushSpreadsheetHistory(stack, baseSnapshot());
    }
    expect(stack).toHaveLength(SPREADSHEET_HISTORY_MAX);
  });
});
