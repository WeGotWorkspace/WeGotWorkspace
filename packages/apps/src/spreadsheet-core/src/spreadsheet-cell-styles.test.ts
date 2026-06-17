import { describe, expect, it } from "vitest";
import {
  applyStyleToSheet,
  parseSheetCells,
  resolveCellStyle,
  selectionStyleState,
  styleApplyTargetsForSelection,
  toggleBooleanStyle,
} from "@/spreadsheet-core/src/spreadsheet-cell-styles";
import { createDefaultSheet, parseYcsv } from "@/spreadsheet-core/src/ycsv/ycsv";

describe("spreadsheet-cell-styles", () => {
  it("parses cells frontmatter", () => {
    const cells = parseSheetCells({
      "A1:H1": { style: { bold: true, fill: "#f5f5f5" } },
      D8: { style: { border: true } },
    });
    expect(cells["A1:H1"]?.style.bold).toBe(true);
    expect(cells.D8?.style.border).toBe(true);
  });

  it("resolves column and cell overrides with cell winning", () => {
    const sheet = createDefaultSheet();
    sheet.columnSettings[0] = {
      ...sheet.columnSettings[0],
      style: { fill: "#ffffff", bold: true },
    };
    sheet.cells = {
      A2: { style: { fill: "#fff3cd", border: true } },
    };
    const resolved = resolveCellStyle(1, 0, sheet.columnSettings, sheet.cells);
    expect(resolved.fill).toBe("#fff3cd");
    expect(resolved.bold).toBe(true);
    expect(resolved.border).toBe(true);
  });

  it("maps whole-column selection to column targets", () => {
    const sheet = createDefaultSheet();
    const targets = styleApplyTargetsForSelection(
      { kind: "cols", start: 1, end: 1 },
      sheet.columnSettings,
      sheet.rows.length,
    );
    expect(targets).toEqual([{ kind: "column", column: 1 }]);
  });

  it("maps cell range selection to a cells key", () => {
    const sheet = createDefaultSheet();
    const targets = styleApplyTargetsForSelection(
      { kind: "range", start: { row: 1, column: 0 }, end: { row: 1, column: 2 } },
      sheet.columnSettings,
      sheet.rows.length,
    );
    expect(targets).toEqual([{ kind: "cells", key: "A2:C2" }]);
  });

  it("applyStyleToSheet writes column style for column selection", () => {
    const sheet = createDefaultSheet();
    const next = applyStyleToSheet(sheet, { kind: "cols", start: 0, end: 0 }, { bold: true });
    expect((next.columnSettings[0].style as { bold?: boolean }).bold).toBe(true);
  });

  it("applyStyleToSheet writes cells map for range selection", () => {
    const sheet = createDefaultSheet();
    const next = applyStyleToSheet(
      sheet,
      { kind: "range", start: { row: 0, column: 0 }, end: { row: 0, column: 1 } },
      { fill: "#dbeafe" },
    );
    expect(next.cells?.["A1:B1"]?.style.fill).toBe("#dbeafe");
  });

  it("selectionStyleState reflects effective styles", () => {
    const sheet = createDefaultSheet();
    sheet.cells = { A2: { style: { bold: true } } };
    const state = selectionStyleState({ kind: "cell", row: 1, column: 0 }, sheet);
    expect(state?.bold).toBe(true);
  });

  it("toggleBooleanStyle flips all-on to off", () => {
    expect(toggleBooleanStyle(true)).toBe(false);
    expect(toggleBooleanStyle("mixed")).toBe(true);
    expect(toggleBooleanStyle(false)).toBe(true);
  });

  it("round-trips cells through parseYcsv", () => {
    const ycsv = `---
ycsv_version: 1
cells:
  A1:B1:
    style:
      bold: true
      fill: "#f5f5f5"
---
A,B
1,2
`;
    const workbook = parseYcsv(ycsv);
    expect(workbook.sheets[0].cells?.["A1:B1"]?.style.bold).toBe(true);
  });
});
