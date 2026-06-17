import { describe, expect, it } from "vitest";
import { tokenizeFormula } from "@/spreadsheet-core/src/formula-highlight";
import { buildFormulaDefContext } from "@/spreadsheet-core/src/spreadsheet-defs-utils";
import { buildFormulaSheetContext } from "@/spreadsheet-core/src/formula-suggest";
import { parseYcsv } from "@/spreadsheet-core/src/ycsv/ycsv";
import { SAMPLE_MULTI_SHEET_YCSV } from "@/spreadsheet-core/src/fixtures/sample-sheet";

function sheetContextFromWorkbook() {
  const workbook = parseYcsv(SAMPLE_MULTI_SHEET_YCSV);
  const sheets = workbook.sheets.map((s) => ({
    ref: s.ref,
    name: s.name,
    columnSettings: s.columnSettings,
  }));
  return buildFormulaSheetContext(sheets);
}

describe("tokenizeFormula cross-sheet refs", () => {
  const { sheetRefs, sheetColumnRefs } = sheetContextFromWorkbook();
  const consts = new Set(["btw"]);
  const refs = new Set(["product", "prijs", "totaal_incl"]);

  it("tokenizes a single cross-sheet cell ref", () => {
    const toks = tokenizeFormula("categorieen!label1", consts, refs, sheetRefs, sheetColumnRefs);
    expect(toks).toEqual([{ type: "sheetref", text: "categorieen!label1" }]);
  });

  it("tokenizes a cross-sheet range", () => {
    const toks = tokenizeFormula(
      "SUM(producten!totaal_incl2:producten!totaal_incl3)",
      consts,
      refs,
      sheetRefs,
      sheetColumnRefs,
    );
    expect(toks.filter((t) => t.type === "sheetref").map((t) => t.text)).toEqual([
      "producten!totaal_incl2",
      "producten!totaal_incl3",
    ]);
  });

  it("keeps same-sheet refs as ref tokens", () => {
    const toks = tokenizeFormula("prijs2*(1+btw)", consts, refs, sheetRefs, sheetColumnRefs);
    expect(toks).toEqual([
      { type: "ref", text: "prijs2" },
      { type: "op", text: "*" },
      { type: "op", text: "(" },
      { type: "number", text: "1" },
      { type: "op", text: "+" },
      { type: "const", text: "btw" },
      { type: "op", text: ")" },
    ]);
  });

  it("tokenizes resolved A1 cross-sheet refs", () => {
    const toks = tokenizeFormula("categorieen!B1", consts, refs, sheetRefs, sheetColumnRefs);
    expect(toks).toEqual([{ type: "sheetref", text: "categorieen!B1" }]);
  });
});

describe("tokenizeFormula mapping def access", () => {
  const defs = {
    btw: 0.21,
    categorieen: { zuivel: "Zuivel", groente: "Groente" },
  };
  const { consts, mappingDefs } = buildFormulaDefContext(defs);
  const refs = new Set<string>();

  it("tokenizes name.key as const, op, and defkey", () => {
    const toks = tokenizeFormula(
      "categorieen.zuivel",
      consts,
      refs,
      new Set(),
      new Map(),
      mappingDefs,
    );
    expect(toks).toEqual([
      { type: "const", text: "categorieen" },
      { type: "op", text: "." },
      { type: "defkey", text: "zuivel" },
    ]);
  });

  it("tokenizes def name and dot when key is not yet typed", () => {
    const toks = tokenizeFormula("categorieen.", consts, refs, new Set(), new Map(), mappingDefs);
    expect(toks).toEqual([
      { type: "const", text: "categorieen" },
      { type: "op", text: "." },
    ]);
  });
});
