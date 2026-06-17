import { describe, expect, it } from "vitest";
import { mergeSpreadsheetLabels } from "@/spreadsheet-core/src/spreadsheet-labels";
import {
  cellsInGridSelection,
  selectionInfoFromGridSelection,
} from "@/spreadsheet-core/src/spreadsheet-selection-info";

const labels = mergeSpreadsheetLabels();
const columnSettings = [
  { ref: "product", name: "Product" },
  { ref: "aantal", name: "Qty" },
];

describe("selectionInfoFromGridSelection", () => {
  it("describes a single selected row", () => {
    expect(
      selectionInfoFromGridSelection({ kind: "rows", start: 1, end: 1 }, columnSettings, labels),
    ).toEqual({
      label: "2",
      value: "entire row 2",
      multi: true,
    });
  });

  it("describes multiple selected rows", () => {
    expect(
      selectionInfoFromGridSelection({ kind: "rows", start: 1, end: 3 }, columnSettings, labels),
    ).toEqual({
      label: "2:4",
      value: "3 rows selected",
      multi: true,
    });
  });

  it("describes a selected column", () => {
    expect(
      selectionInfoFromGridSelection({ kind: "cols", start: 0, end: 0 }, columnSettings, labels),
    ).toEqual({
      label: "product",
      value: "entire column product",
      multi: true,
    });
  });

  it("returns null for a single cell", () => {
    expect(
      selectionInfoFromGridSelection({ kind: "cell", row: 1, column: 0 }, columnSettings, labels),
    ).toBeNull();
  });
});

describe("cellsInGridSelection", () => {
  const columnCount = 3;
  const matrixRowCount = 5; // row 0 = header, rows 1–4 = data
  const viewOffset = 1;

  it("returns a single cell", () => {
    expect(
      cellsInGridSelection(
        { kind: "cell", row: 2, column: 1 },
        columnCount,
        matrixRowCount,
        viewOffset,
      ),
    ).toEqual([{ row: 2, column: 1 }]);
  });

  it("expands a rectangular range", () => {
    expect(
      cellsInGridSelection(
        {
          kind: "range",
          start: { row: 1, column: 0 },
          end: { row: 2, column: 1 },
        },
        columnCount,
        matrixRowCount,
        viewOffset,
      ),
    ).toEqual([
      { row: 1, column: 0 },
      { row: 1, column: 1 },
      { row: 2, column: 0 },
      { row: 2, column: 1 },
    ]);
  });

  it("expands row selection across all columns and skips the header row", () => {
    expect(
      cellsInGridSelection(
        { kind: "rows", start: 0, end: 2 },
        columnCount,
        matrixRowCount,
        viewOffset,
      ),
    ).toEqual([
      { row: 1, column: 0 },
      { row: 1, column: 1 },
      { row: 1, column: 2 },
      { row: 2, column: 0 },
      { row: 2, column: 1 },
      { row: 2, column: 2 },
    ]);
  });

  it("expands column selection across all data rows", () => {
    expect(
      cellsInGridSelection(
        { kind: "cols", start: 0, end: 1 },
        columnCount,
        matrixRowCount,
        viewOffset,
      ),
    ).toEqual([
      { row: 1, column: 0 },
      { row: 2, column: 0 },
      { row: 3, column: 0 },
      { row: 4, column: 0 },
      { row: 1, column: 1 },
      { row: 2, column: 1 },
      { row: 3, column: 1 },
      { row: 4, column: 1 },
    ]);
  });
});
