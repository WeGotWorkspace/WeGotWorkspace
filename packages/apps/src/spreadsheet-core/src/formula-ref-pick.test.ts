import { describe, expect, it } from "vitest";
import {
  cellRefFor,
  insertRefAtCaret,
  isOpenFormulaContext,
  moveCellPoint,
  rangeRefFor,
  sheetRefBeforeCaret,
  withSheetPrefix,
} from "@/spreadsheet-core/src/formula-ref-pick";
import type { ColumnSetting } from "@/spreadsheet-core/src/ycsv/ycsv";

const namedColumns: ColumnSetting[] = [
  { ref: "prijs", name: "Prijs" },
  { ref: "aantal", name: "Aantal" },
];

describe("cellRefFor", () => {
  it("uses named column refs", () => {
    expect(cellRefFor(1, 0, namedColumns)).toBe("prijs2");
  });

  it("falls back to A1 letters for unnamed columns", () => {
    expect(cellRefFor(0, 1, [{ ref: "B" }])).toBe("B1");
  });
});

describe("rangeRefFor", () => {
  it("builds a named range", () => {
    expect(rangeRefFor({ row: 1, column: 0 }, { row: 4, column: 0 }, namedColumns)).toBe(
      "prijs2:prijs5",
    );
  });

  it("collapses identical endpoints to a single cell", () => {
    expect(rangeRefFor({ row: 2, column: 1 }, { row: 2, column: 1 }, namedColumns)).toBe("aantal3");
  });
});

describe("insertRefAtCaret", () => {
  it("inserts at the caret", () => {
    const result = insertRefAtCaret("=SUM(", 5, 0, "prijs2");
    expect(result).toEqual({ next: "=SUM(prijs2", caret: 11, insertedLen: 6 });
  });

  it("replaces a previously inserted reference", () => {
    const first = insertRefAtCaret("=SUM(", 5, 0, "prijs2");
    const second = insertRefAtCaret(first.next, first.caret, first.insertedLen, "prijs3");
    expect(second).toEqual({ next: "=SUM(prijs3", caret: 11, insertedLen: 6 });
  });

  it("replaces with a range while extending", () => {
    const first = insertRefAtCaret("=SUM(", 5, 0, "prijs2");
    const second = insertRefAtCaret(first.next, first.caret, first.insertedLen, "prijs2:prijs5");
    expect(second.next).toBe("=SUM(prijs2:prijs5");
  });
});

describe("isOpenFormulaContext", () => {
  it("is open after = and operators", () => {
    expect(isOpenFormulaContext("=SUM(", 5)).toBe(true);
    expect(isOpenFormulaContext("=A1+", 5)).toBe(true);
    expect(isOpenFormulaContext("=A1+prijs2", 9)).toBe(false);
  });
});

describe("sheetRefBeforeCaret", () => {
  it("detects sheet-qualified open tokens", () => {
    expect(sheetRefBeforeCaret("=producten!pri", 14)).toBe("producten");
    expect(sheetRefBeforeCaret("=SUM(prijs2,", 11)).toBe(null);
  });
});

describe("withSheetPrefix", () => {
  it("adds a prefix when the target sheet differs from context", () => {
    expect(withSheetPrefix("prijs2", "categorieen", "producten", "producten")).toBe(
      "categorieen!prijs2",
    );
  });

  it("omits prefix for the active/context sheet", () => {
    expect(withSheetPrefix("prijs2", "producten", "producten", "producten")).toBe("prijs2");
  });
});

describe("moveCellPoint", () => {
  it("clamps movement inside the grid", () => {
    expect(moveCellPoint({ row: 0, column: 0 }, "ArrowUp", 10, 5)).toEqual({ row: 0, column: 0 });
    expect(moveCellPoint({ row: 0, column: 0 }, "ArrowRight", 10, 5)).toEqual({
      row: 0,
      column: 1,
    });
  });
});
