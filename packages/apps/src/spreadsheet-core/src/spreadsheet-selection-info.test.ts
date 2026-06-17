import { describe, expect, it } from "vitest";
import { mergeSpreadsheetLabels } from "@/spreadsheet-core/src/spreadsheet-labels";
import { selectionInfoFromGridSelection } from "@/spreadsheet-core/src/spreadsheet-selection-info";

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
