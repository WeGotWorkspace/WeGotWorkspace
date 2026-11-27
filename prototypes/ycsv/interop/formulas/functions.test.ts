// Spike 11: proposed v1 function set, checked against LibreOffice as the reference engine.
// Builds one sheet with input data + one test formula per row, lets LibreOffice recalculate
// it (xlsx → xlsx), then evaluates the same formulas with the upstream engine
// (spreadsheet-core + formulajs). Writes interop/formulas/functions-results.json.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import * as formulajs from "@formulajs/formulajs";
import * as XLSX from "xlsx";
import { expect, test } from "vitest";
import { evaluateWorkbook } from "@/spreadsheet-core/src/ycsv/ycsv-formula-engine";
import type { ParsedWorkbook } from "@/spreadsheet-core/src/ycsv/ycsv";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Input block A1:E6 (row 1 = header). A: numbers with a blank, B: text, C: dates, D: booleans, E: text numbers.
const INPUT: (string | number | boolean | null | Date)[][] = [
  ["n", "t", "d", "b", "s"],
  [1, "a", new Date(Date.UTC(2026, 0, 5)), true, "3"],
  [2, "B", new Date(Date.UTC(2026, 0, 31)), false, " 4 "],
  [3, "c", new Date(Date.UTC(2026, 1, 28)), true, "x"],
  [null, "a", new Date(Date.UTC(2024, 1, 29)), true, ""],
  [5, "", new Date(Date.UTC(2026, 11, 31)), false, "1e3"],
];

// [group, formula]. Grouped by the proposed v1 set; edge cases marked with "edge:".
export const TESTS: [string, string][] = [
  ["math", "SUM(A2:A6)"], ["math", "SUMIF(B2:B6,\"a\",A2:A6)"], ["math", "SUMIFS(A2:A6,B2:B6,\"a\",D2:D6,TRUE)"],
  ["math", "SUMPRODUCT(A2:A6,A2:A6)"], ["math", "ROUND(2.675,2)"], ["math", "ROUND(-2.5,0)"], ["math", "ROUNDUP(2.1,0)"],
  ["math", "ROUNDDOWN(-2.9,0)"], ["math", "INT(-2.5)"], ["math", "MOD(-7,3)"], ["math", "ABS(-3)"], ["math", "PRODUCT(A2:A6)"],
  ["math", "POWER(2,10)"], ["math", "SQRT(16)"], ["math", "CEILING(2.1,0.5)"], ["math", "FLOOR(2.9,0.5)"],
  ["stat", "AVERAGE(A2:A6)"], ["stat", "AVERAGEIF(B2:B6,\"a\",A2:A6)"], ["stat", "COUNT(A2:A6)"], ["stat", "COUNTA(B2:B6)"],
  ["stat", "COUNTBLANK(A2:A6)"], ["stat", "COUNTIF(B2:B6,\"a\")"], ["stat", "COUNTIFS(B2:B6,\"a\",D2:D6,TRUE)"],
  ["stat", "MIN(A2:A6)"], ["stat", "MAX(A2:A6)"], ["stat", "MEDIAN(A2:A6)"], ["stat", "MAXIFS(A2:A6,D2:D6,TRUE)"], ["stat", "MINIFS(A2:A6,D2:D6,TRUE)"],
  ["logic", "IF(A2>1,\"yes\",\"no\")"], ["logic", "IFS(A3=1,\"one\",A3=2,\"two\")"], ["logic", "AND(D2,D4)"], ["logic", "OR(D3,D6)"],
  ["logic", "NOT(D2)"], ["logic", "IFERROR(1/0,\"err\")"], ["logic", "IFNA(NA(),\"na\")"], ["logic", "SWITCH(A4,1,\"a\",3,\"c\",\"?\")"],
  ["lookup", "VLOOKUP(\"c\",B2:D6,2,FALSE)"], ["lookup", "VLOOKUP(2.5,A2:B4,2,TRUE)"], ["lookup", "HLOOKUP(\"t\",A1:E3,3,FALSE)"],
  ["lookup", "XLOOKUP(\"c\",B2:B6,A2:A6,\"none\")"], ["lookup", "INDEX(A2:B6,3,2)"], ["lookup", "MATCH(\"c\",B2:B6,0)"],
  ["lookup", "XMATCH(3,A2:A6)"], ["lookup", "CHOOSE(2,\"x\",\"y\",\"z\")"], ["lookup", "ROW(A4)"], ["lookup", "COLUMN(C1)"],
  ["text", "CONCAT(B2,B3)"], ["text", "CONCATENATE(B2,\"-\",A2)"], ["text", "TEXTJOIN(\",\",TRUE,B2:B6)"], ["text", "LEFT(\"abcdef\",2)"],
  ["text", "RIGHT(\"abcdef\",2)"], ["text", "MID(\"abcdef\",2,3)"], ["text", "LEN(\"héllo\")"], ["text", "UPPER(\"straße\")"],
  ["text", "LOWER(\"ABC\")"], ["text", "PROPER(\"jan de vries\")"], ["text", "TRIM(\"  a   b \")"], ["text", "SUBSTITUTE(\"a-b-c\",\"-\",\"+\")"],
  ["text", "FIND(\"b\",\"abc\")"], ["text", "SEARCH(\"B\",\"abc\")"], ["text", "TEXT(1234.5,\"0.00\")"], ["text", "TEXT(C2,\"yyyy-mm-dd\")"],
  ["text", "VALUE(\"12.5\")"], ["text", "REPT(\"ab\",3)"], ["text", "EXACT(\"a\",\"A\")"],
  ["date", "DATE(2026,2,30)"], ["date", "YEAR(C2)"], ["date", "MONTH(C3)"], ["date", "DAY(C4)"], ["date", "WEEKDAY(C2)"],
  ["date", "WEEKNUM(C2)"], ["date", "ISOWEEKNUM(C2)"], ["date", "EDATE(C3,1)"], ["date", "EOMONTH(C2,0)"], ["date", "DATEDIF(C2,C6,\"m\")"],
  ["date", "NETWORKDAYS(C2,C3)"], ["date", "WORKDAY(C2,10)"], ["date", "DAYS(C6,C2)"], ["date", "C3-C2"], ["date", "C2+1"],
  ["date", "TIME(9,30,0)"], ["date", "HOUR(0.75)"], ["date", "DATEVALUE(\"2026-01-05\")"],
  ["info", "ISBLANK(A5)"], ["info", "ISNUMBER(A2)"], ["info", "ISTEXT(B2)"], ["info", "ISERROR(1/0)"], ["info", "ISNA(NA())"],
  ["finance", "PMT(0.05/12,60,10000)"],
  ["edge: blank", "A5+1"], ["edge: blank", "A5=0"], ["edge: blank", "A5=\"\""], ["edge: blank", "LEN(A5)"],
  ["edge: text→number", "E2+1"], ["edge: text→number", "E3+1"], ["edge: text→number", "SUM(E2:E6)"], ["edge: text→number", "\"3\"*2"],
  ["edge: text→number", "E6*1"], ["edge: text compare", "\"a\"=\"A\""], ["edge: text compare", "\"a\"<\"B\""],
  ["edge: bool math", "TRUE+TRUE"], ["edge: bool math", "SUM(D2:D6)"], ["edge: float", "0.1+0.2"], ["edge: float", "0.1+0.2=0.3"],
  ["edge: float", "1-0.9"], ["edge: precedence", "-2^2"], ["edge: precedence", "2^3^2"], ["edge: precedence", "50%*10"],
  ["edge: concat", "1&2"], ["edge: concat", "B2&C2"], ["edge: errors", "SUM(A2:A6,1/0)"], ["edge: errors", "#N/A"],
];

const EPOCH = Date.UTC(1899, 11, 30);
const toSerial = (d: Date) => (d.getTime() - EPOCH) / 86_400_000;

function libreValues(): unknown[] {
  const dir = mkdtempSync(join(tmpdir(), "lo-fn-"));
  const profile = mkdtempSync(join(tmpdir(), "lo-profile-"));
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("t");
    INPUT.forEach((row, r) => row.forEach((v, c) => {
      if (v !== null) ws.getCell(r + 1, c + 1).value = v as ExcelJS.CellValue;
    }));
    TESTS.forEach(([, f], i) => {
      ws.getCell(i + 1, 7).value = { formula: f.replace(/\b(XLOOKUP|XMATCH|TEXTJOIN|CONCAT|IFS|SWITCH|MAXIFS|MINIFS|IFNA|DAYS|ISOWEEKNUM)\(/g, "_xlfn.$1(") } as ExcelJS.CellFormulaValue;
    });
    return wb.xlsx.writeBuffer().then((buf) => {
      writeFileSync(join(dir, "fn.xlsx"), Buffer.from(buf));
      execFileSync("soffice", [`-env:UserInstallation=file://${profile}`, "--headless", "--norestore", "--convert-to", "ods", "--outdir", join(dir, "o"), join(dir, "fn.xlsx")], { stdio: "pipe", timeout: 120_000 });
      const out = XLSX.read(readFileSync(join(dir, "o", "fn.ods")), { cellFormula: true });
      const sheet = out.Sheets[out.SheetNames[0]!]!;
      return TESTS.map((_, i) => {
        const c = sheet[`G${i + 1}`] as XLSX.CellObject | undefined;
        if (!c) return null;
        if (c.t === "e") return c.w ?? "#ERR";
        return c.v;
      });
    }) as unknown as unknown[];
  } finally {
    setTimeout(() => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(profile, { recursive: true, force: true });
    }, 5_000);
  }
}

function engineValues(): unknown[] {
  const rows = INPUT.map((row) => row.map((v) => (v === null ? "" : v instanceof Date ? String(toSerial(v)) : typeof v === "boolean" ? String(v) : String(v))));
  const grid = rows.map((r) => [...r, "", ""]);
  TESTS.forEach(([, f], i) => {
    while (grid.length <= i) grid.push(["", "", "", "", "", "", ""]);
    grid[i]![6] = `=${f}`;
  });
  const width = 7;
  const refs = Array.from({ length: width }, (_, i) => String.fromCharCode(65 + i));
  const wb: ParsedWorkbook = {
    version: 1, defs: {}, warnings: [],
    sheets: [{ ref: "t", name: "t", columnSettings: refs.map((ref) => ({ ref, name: ref })), defs: {}, refs, headers: grid[0]!, rows: grid.slice(1), hadHeader: true }],
  };
  const computed = evaluateWorkbook(wb)[0]!;
  return TESTS.map((_, i) => {
    const c = computed[i]?.[6];
    if (!c) return null;
    if (c.error) return c.display;
    return c.value instanceof Date ? toSerial(c.value) : c.value;
  });
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  if (typeof a === "string" && typeof b === "string" && a.startsWith("#") && b.startsWith("#")) return a.replace(/[!?]$/, "") === b.replace(/[!?]$/, "");
  return a === b;
}

test("v1 function set vs LibreOffice", async () => {
  const lo = (await libreValues()) as unknown[];
  const eng = engineValues();
  const fj = formulajs as unknown as Record<string, unknown>;
  const rows = TESTS.map(([group, f], i) => {
    const fn = /^([A-Z][A-Z0-9.]*)\(/.exec(f)?.[1];
    return { group, formula: `=${f}`, inFormulajs: fn ? typeof fj[fn] === "function" : null, libreoffice: lo[i], engine: eng[i], match: same(lo[i], eng[i]) };
  });
  writeFileSync(here("./functions-results.json"), `${JSON.stringify(rows, null, 2)}\n`);
  expect(rows.length).toBe(TESTS.length);
}, 300_000);
