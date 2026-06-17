import { describe, expect, it } from "vitest";
import {
  colLetter,
  colIndexFromLetter,
  createDefaultSheet,
  createDefaultWorkbook,
  DEFAULT_EMPTY_YCSV,
  DEFAULT_SHEET_COLUMN_COUNT,
  DEFAULT_SHEET_ROW_COUNT,
  formatValue,
  parseYcsv,
  resolveFormula,
  serializeYcsv,
} from "@/spreadsheet-core/src/ycsv/ycsv";
import { SAMPLE_MULTI_SHEET_YCSV, SAMPLE_YCSV } from "@/spreadsheet-core/src/fixtures/sample-sheet";

describe("colLetter / colIndexFromLetter", () => {
  it("round-trips column identifiers", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colIndexFromLetter("A")).toBe(0);
    expect(colIndexFromLetter("Z")).toBe(25);
    expect(colIndexFromLetter("AA")).toBe(26);
  });
});

describe("parseYcsv — single sheet", () => {
  it("parses version, defs, columns, and data rows", () => {
    const workbook = parseYcsv(SAMPLE_YCSV);
    expect(workbook.version).toBe(1);
    expect(workbook.defs.btw).toBe(0.21);
    expect(workbook.sheets).toHaveLength(1);

    const sheet = workbook.sheets[0];
    expect(sheet.ref).toBe("sheet1");
    expect(sheet.refs).toEqual(["product", "aantal", "prijs", "totaal", "marge"]);
    expect(sheet.hadHeader).toBe(true);
    expect(sheet.rows).toHaveLength(5);
    expect(sheet.rows[0][0]).toBe("Appels");
    expect(sheet.columnSettings[2].type).toBe("currency");
  });

  it("detects a header row when no columns are defined", () => {
    const workbook = parseYcsv(`---\nycsv_version: 1\n---\nproduct,aantal\nAppels,6\nBrood,2\n`);
    const sheet = workbook.sheets[0];
    expect(sheet.hadHeader).toBe(true);
    expect(sheet.refs).toEqual(["product", "aantal"]);
    expect(sheet.rows).toEqual([
      ["Appels", "6"],
      ["Brood", "2"],
    ]);
  });

  it("falls back to A-Z identifiers without a header or columns", () => {
    const workbook = parseYcsv(`---\nycsv_version: 1\n---\nAppels,6,0.45\nBrood,2,2.99\n`);
    const sheet = workbook.sheets[0];
    expect(sheet.hadHeader).toBe(false);
    expect(sheet.refs).toEqual(["A", "B", "C"]);
    expect(sheet.columnSettings.every((c) => c.refExplicit === false)).toBe(true);
    expect(sheet.rows).toHaveLength(2);
  });

  it("marks frontmatter column refs as refExplicit", () => {
    const workbook = parseYcsv(SAMPLE_YCSV);
    const sheet = workbook.sheets[0];
    expect(sheet.columnSettings[0].refExplicit).toBe(true);
    expect(sheet.columnSettings[0].ref).toBe("product");
  });

  it("does not mark header-inferred A-Z refs as refExplicit", () => {
    const workbook = parseYcsv(`---\nycsv_version: 1\n---\nA,B\n1,2\n3,4\n`);
    const sheet = workbook.sheets[0];
    expect(sheet.hadHeader).toBe(true);
    expect(sheet.columnSettings[0].ref).toBe("a");
    expect(sheet.columnSettings[0].name).toBe("A");
    expect(sheet.columnSettings[0].refExplicit).toBe(false);
  });

  it("warns but parses a higher spec version", () => {
    const workbook = parseYcsv(`---\nycsv_version: 2\n---\na,b\n1,2\n`);
    expect(workbook.version).toBe(2);
    expect(workbook.warnings.some((w) => w.includes("best-effort"))).toBe(true);
  });

  it("accepts the deprecated `constants` alias for defs", () => {
    const workbook = parseYcsv(`---\nycsv_version: 1\nconstants:\n  btw: 0.21\n---\na\n1\n`);
    expect(workbook.defs.btw).toBe(0.21);
  });
});

describe("parseYcsv — multi sheet", () => {
  it("splits multiple CSV blocks into sheets in order", () => {
    const workbook = parseYcsv(SAMPLE_MULTI_SHEET_YCSV);
    expect(workbook.sheets).toHaveLength(2);
    expect(workbook.sheets[0].ref).toBe("producten");
    expect(workbook.sheets[0].name).toBe("Productenoverzicht");
    expect(workbook.sheets[1].ref).toBe("categorieen");
    expect(workbook.sheets[1].rows).toEqual([
      ["fruit", "Fruit"],
      ["bakkerij", "Bakkerij"],
    ]);
    // Workbook-level defs are shared across sheets.
    expect(workbook.sheets[1].defs.btw).toBe(0.21);
  });

  it("lists a sheet without columns in frontmatter using A-Z fallback", () => {
    const text = `---
ycsv_version: 1
sheets:
  - ref: producten
    columns:
      - ref: product
        type: string
  - ref: notes
    name: Notes
---
product
Appels
---
1,2
3,4
`;
    const workbook = parseYcsv(text);
    expect(workbook.sheets).toHaveLength(2);
    expect(workbook.sheets[1].ref).toBe("notes");
    expect(workbook.sheets[1].name).toBe("Notes");
    expect(workbook.sheets[1].refs).toEqual(["A", "B"]);
    expect(workbook.sheets[1].rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("infers multiple sheets from extra CSV blocks when sheets frontmatter is missing", () => {
    const text = `---
ycsv_version: 1
columns:
  - ref: product
    type: string
---
product
Appels
---
2,3
4,5
`;
    const workbook = parseYcsv(text);
    expect(workbook.warnings.some((w) => w.includes("inferring sheet1"))).toBe(true);
    expect(workbook.sheets).toHaveLength(2);
    expect(workbook.sheets[0].refs).toEqual(["product"]);
    expect(workbook.sheets[1].ref).toBe("sheet2");
    expect(workbook.sheets[1].refs).toEqual(["A", "B"]);
    expect(workbook.sheets[1].rows).toEqual([
      ["2", "3"],
      ["4", "5"],
    ]);
  });
});

describe("resolveFormula", () => {
  it("rewrites named refs to A1 and inlines scalar defs", () => {
    const workbook = parseYcsv(SAMPLE_YCSV);
    const sheet = workbook.sheets[0];
    expect(resolveFormula("=prijs2*aantal2*(1+btw)", sheet, workbook)).toBe("=C2*B2*(1+0.21)");
  });

  it("inlines mapping-def label access via name.key", () => {
    const text = `---\nycsv_version: 1\ndefs:\n  categorie:\n    zuivel: Zuivel\ncolumns:\n  - ref: a\n---\na\nx\n`;
    const workbook = parseYcsv(text);
    const sheet = workbook.sheets[0];
    expect(resolveFormula("=categorie.zuivel", sheet, workbook)).toBe('="Zuivel"');
  });

  it("rewrites cross-sheet references to sheet!A1", () => {
    const workbook = parseYcsv(SAMPLE_MULTI_SHEET_YCSV);
    const producten = workbook.sheets[0];
    expect(resolveFormula("=categorieen!label1", producten, workbook)).toBe("=categorieen!B1");
  });
});

describe("default sheet bootstrap", () => {
  it("creates five columns A–E and five empty data rows", () => {
    const sheet = createDefaultSheet("sheet2");
    expect(sheet.ref).toBe("sheet2");
    expect(sheet.refs).toEqual(["A", "B", "C", "D", "E"]);
    expect(sheet.headers).toEqual(["A", "B", "C", "D", "E"]);
    expect(sheet.rows).toHaveLength(DEFAULT_SHEET_ROW_COUNT);
    expect(sheet.rows.every((row) => row.length === DEFAULT_SHEET_COLUMN_COUNT)).toBe(true);
    expect(sheet.rows.every((row) => row.every((cell) => cell === ""))).toBe(true);
    expect(sheet.hadHeader).toBe(true);
  });

  it("round-trips DEFAULT_EMPTY_YCSV with five columns and five data rows", () => {
    const workbook = parseYcsv(DEFAULT_EMPTY_YCSV);
    expect(workbook.sheets).toHaveLength(1);
    const sheet = workbook.sheets[0]!;
    expect(sheet.refs).toEqual(["a", "b", "c", "d", "e"]);
    expect(sheet.rows).toHaveLength(5);
    expect(sheet.rows.every((row) => row.every((cell) => cell === ""))).toBe(true);

    const reparsed = parseYcsv(serializeYcsv(workbook));
    expect(reparsed.sheets[0]!.refs).toEqual(sheet.refs);
    expect(reparsed.sheets[0]!.rows).toEqual(sheet.rows);
  });

  it("round-trips a default workbook built from createDefaultWorkbook", () => {
    const serialized = serializeYcsv(createDefaultWorkbook());
    const reparsed = parseYcsv(serialized);
    expect(reparsed.sheets[0]!.columnSettings).toHaveLength(DEFAULT_SHEET_COLUMN_COUNT);
    expect(reparsed.sheets[0]!.rows).toHaveLength(DEFAULT_SHEET_ROW_COUNT);
  });
});

describe("serializeYcsv round-trip", () => {
  it("re-parses to an equivalent single-sheet workbook", () => {
    const workbook = parseYcsv(SAMPLE_YCSV);
    const serialized = serializeYcsv(workbook);
    const reparsed = parseYcsv(serialized);
    expect(reparsed.version).toBe(1);
    expect(reparsed.defs.btw).toBe(0.21);
    expect(reparsed.sheets[0].refs).toEqual(workbook.sheets[0].refs);
    expect(reparsed.sheets[0].rows).toEqual(workbook.sheets[0].rows);
  });

  it("preserves multiple sheets through a round-trip", () => {
    const workbook = parseYcsv(SAMPLE_MULTI_SHEET_YCSV);
    const reparsed = parseYcsv(serializeYcsv(workbook));
    expect(reparsed.sheets.map((s) => s.ref)).toEqual(["producten", "categorieen"]);
    expect(reparsed.sheets[1].rows).toEqual(workbook.sheets[1].rows);
  });

  it("keeps sheets without frontmatter columns through a round-trip", () => {
    const text = `---
ycsv_version: 1
sheets:
  - ref: producten
    columns:
      - ref: product
        type: string
  - ref: notes
    name: Notes
---
product
Appels
---
1,2
3,4
`;
    const workbook = parseYcsv(text);
    const reparsed = parseYcsv(serializeYcsv(workbook));
    expect(reparsed.sheets.map((s) => s.ref)).toEqual(["producten", "notes"]);
    expect(reparsed.sheets[1].refs).toEqual(["a", "b"]);
    expect(reparsed.sheets[1].rows).toEqual(workbook.sheets[1].rows);
  });
});

describe("formatValue", () => {
  it("formats currency with locale and fraction digits", () => {
    const formatted = formatValue("0.45", {
      type: "currency",
      currency: "EUR",
      locale: "nl-NL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(formatted).toContain("0,45");
  });

  it("treats percent values as display values (50 = 50%)", () => {
    expect(formatValue("50", { type: "percent" })).toContain("50");
  });

  it("returns strings unchanged", () => {
    expect(formatValue("Appels", { type: "string" })).toBe("Appels");
  });
});
