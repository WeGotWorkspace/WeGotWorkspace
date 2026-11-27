import { describe, expect, it } from "vitest";
import { parseYcsv } from "@/spreadsheet-core/src/ycsv/ycsv";
import { evaluateWorkbook } from "@/spreadsheet-core/src/ycsv/ycsv-formula-engine";
import { SAMPLE_MULTI_SHEET_YCSV, SAMPLE_YCSV } from "@/spreadsheet-core/src/fixtures/sample-sheet";

/** Build a single-sheet workbook from a CSV body (no header, A-Z refs). */
function workbookFromRows(body: string) {
  return parseYcsv(`---\nycsv_version: 1\n---\n${body}\n`);
}

describe("evaluateWorkbook", () => {
  it("computes arithmetic with named refs and a scalar def", () => {
    const computed = evaluateWorkbook(parseYcsv(SAMPLE_YCSV));
    // matrix row 1 == first data row (Appels): 0.45 * 6 * 1.21 = 3.267
    const appelsTotaal = computed[0][1][3];
    expect(appelsTotaal.error).toBe(false);
    expect(Number(appelsTotaal.value)).toBeCloseTo(3.267, 5);
  });

  it("computes SUM over a column range", () => {
    const computed = evaluateWorkbook(parseYcsv(SAMPLE_YCSV));
    // Totaal row (matrix row 5) sums totaal2:totaal5.
    const total = computed[0][5][3];
    expect(total.error).toBe(false);
    // 3.267 + (2.99*2*1.21) + (1.19*3*1.21) + (8.5*1*1.21)
    expect(Number(total.value)).toBeCloseTo(3.267 + 7.2358 + 4.3197 + 10.285, 3);
  });

  // Row 0 of each matrix is the synthetic header, so the first data row is `A2`.
  // Formulas containing commas must be quoted in the CSV body (RFC 4180).
  it("evaluates IF with comparison operators", () => {
    const computed = evaluateWorkbook(
      workbookFromRows(`10,"=IF(A2>5,""high"",""low"")"\n3,"=IF(A3>5,""high"",""low"")"`),
    );
    expect(computed[0][1][1].value).toBe("high");
    expect(computed[0][2][1].value).toBe("low");
  });

  it("catches errors with IFERROR", () => {
    const computed = evaluateWorkbook(workbookFromRows(`0,"=IFERROR(10/A2,""n/a"")"`));
    expect(computed[0][1][1].error).toBe(false);
    expect(computed[0][1][1].value).toBe("n/a");
  });

  it("flags division by zero as an error", () => {
    const computed = evaluateWorkbook(workbookFromRows(`0,=10/A2`));
    expect(computed[0][1][1].error).toBe(true);
    expect(computed[0][1][1].display).toBe("#DIV/0!");
  });

  it("resolves cross-sheet references", () => {
    const text = `---\nycsv_version: 1\nsheets:\n  - ref: a\n  - ref: b\n---\n10\n---\n=a!A2*2\n`;
    const computed = evaluateWorkbook(parseYcsv(text));
    expect(computed[1][1][0].error).toBe(false);
    expect(Number(computed[1][1][0].value)).toBe(20);
  });

  it("evaluates the multi-sheet sample without errors", () => {
    const computed = evaluateWorkbook(parseYcsv(SAMPLE_MULTI_SHEET_YCSV));
    expect(computed[0][1][2].error).toBe(false);
    expect(Number(computed[0][1][2].value)).toBeCloseTo(0.45 * 1.21, 5);
  });

  it("detects circular references", () => {
    const computed = evaluateWorkbook(workbookFromRows(`=B2,=A2`));
    expect(computed[0][1][0].error).toBe(true);
    expect(computed[0][1][0].display).toBe("#CIRCULAR!");
    expect(computed[0][1][1].error).toBe(true);
  });
});
