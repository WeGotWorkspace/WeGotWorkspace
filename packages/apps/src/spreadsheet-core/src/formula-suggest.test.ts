import { describe, expect, it } from "vitest";
import { computeSuggestions, type FormulaSheetInfo } from "@/spreadsheet-core/src/formula-suggest";
import type { Defs } from "@/spreadsheet-core/src/ycsv/ycsv";
import { parseYcsv } from "@/spreadsheet-core/src/ycsv/ycsv";
import { SAMPLE_MULTI_SHEET_YCSV } from "@/spreadsheet-core/src/fixtures/sample-sheet";

function multiSheetFixture(): {
  sheets: FormulaSheetInfo[];
  productenColumns: FormulaSheetInfo["columnSettings"];
  defs: Defs;
} {
  const workbook = parseYcsv(SAMPLE_MULTI_SHEET_YCSV);
  const producten = workbook.sheets[0];
  const categorieen = workbook.sheets[1];
  return {
    sheets: [
      {
        ref: producten.ref,
        name: producten.name,
        columnSettings: producten.columnSettings,
      },
      {
        ref: categorieen.ref,
        name: categorieen.name,
        columnSettings: categorieen.columnSettings,
      },
    ],
    productenColumns: producten.columnSettings,
    defs: workbook.defs,
  };
}

describe("computeSuggestions cross-sheet refs", () => {
  const { sheets, productenColumns, defs } = multiSheetFixture();

  it("suggests sheet names for a partial sheet ref", () => {
    const suggestions = computeSuggestions("=prod", 5, defs, productenColumns, sheets);
    expect(suggestions.some((s) => s.kind === "sheet" && s.label === "producten")).toBe(true);
    expect(suggestions.find((s) => s.kind === "sheet")?.insert).toBe("producten!");
  });

  it("suggests column refs after sheet!", () => {
    const draft = "=producten!";
    const suggestions = computeSuggestions(draft, draft.length, defs, productenColumns, sheets);
    expect(suggestions.every((s) => s.kind === "ref")).toBe(true);
    expect(suggestions.map((s) => s.label)).toEqual(
      expect.arrayContaining(["product", "prijs", "totaal_incl"]),
    );
  });

  it("suggests filtered column refs while typing after sheet!", () => {
    const draft = "=categorieen!lab";
    const suggestions = computeSuggestions(draft, draft.length, defs, productenColumns, sheets);
    expect(suggestions).toEqual([
      expect.objectContaining({ kind: "ref", label: "label", insert: "label", tokenLen: 3 }),
    ]);
  });

  it("suggests the second sheet in a cross-sheet range", () => {
    const draft = "=SUM(producten!totaal_incl2:prod";
    const suggestions = computeSuggestions(draft, draft.length, defs, productenColumns, sheets);
    expect(suggestions.some((s) => s.kind === "sheet" && s.label === "producten")).toBe(true);
  });

  it("does not suggest sheets for a single-sheet workbook", () => {
    const suggestions = computeSuggestions("=prod", 5, defs, productenColumns, [sheets[0]]);
    expect(suggestions.some((s) => s.kind === "sheet")).toBe(false);
  });
});

const MAPPING_DEFS: Defs = {
  btw: 0.21,
  categorieen: { zuivel: "Zuivel", groente: "Groente", fruit: "Fruit" },
};

describe("computeSuggestions mapping def keys", () => {
  const columns = [{ ref: "product", type: "string" as const }];

  it("suggests all mapping keys after def.", () => {
    const draft = "=categorieen.";
    const suggestions = computeSuggestions(draft, draft.length, MAPPING_DEFS, columns);
    expect(suggestions.every((s) => s.kind === "defkey")).toBe(true);
    expect(suggestions.map((s) => s.label)).toEqual(
      expect.arrayContaining(["categorieen.zuivel", "categorieen.groente", "categorieen.fruit"]),
    );
    expect(suggestions.find((s) => s.label === "categorieen.zuivel")).toMatchObject({
      insert: "zuivel",
      detail: "Zuivel",
      tokenLen: 0,
    });
  });

  it("filters mapping keys while typing a partial key", () => {
    const draft = "=categorieen.zu";
    const suggestions = computeSuggestions(draft, draft.length, MAPPING_DEFS, columns);
    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "defkey",
        label: "zuivel",
        insert: "zuivel",
        detail: "Zuivel",
        tokenLen: 2,
      }),
    ]);
  });

  it("does not suggest keys after dot on a scalar def", () => {
    const draft = "=btw.";
    const suggestions = computeSuggestions(draft, draft.length, MAPPING_DEFS, columns);
    expect(suggestions).toEqual([]);
  });
});
