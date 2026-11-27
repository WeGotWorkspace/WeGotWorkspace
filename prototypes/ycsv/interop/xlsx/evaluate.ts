// Evaluate an imported workbook with the upstream spreadsheet-core engine and compare every
// formula with the value the producing app cached (spike 11).
//
// The engine cannot read the proposed syntax directly (no `$`, ASCII-only refs, no quoted
// refs, no range defs), so each YCSV formula goes YCSV → A1 (the export translator) with
// sheets renamed s0, s1, … and `$` removed. Date literals become serial numbers (P7).
import { evaluateWorkbook } from "@/spreadsheet-core/src/ycsv/ycsv-formula-engine";
import type { ParsedSheet, ParsedWorkbook } from "@/spreadsheet-core/src/ycsv/ycsv";
import type { ImportResult } from "./import";
import { colLetters, ycsvToA1 } from "./translate";

const EPOCH = Date.UTC(1899, 11, 30);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const ISO_T = /^\d{2}:\d{2}:\d{2}$/;

export function isoToSerial(v: string): number | null {
  if (ISO_DATE.test(v)) return (Date.parse(`${v}T00:00:00Z`) - EPOCH) / 86_400_000;
  if (ISO_DT.test(v)) return (Date.parse(`${v}Z`) - EPOCH) / 86_400_000;
  if (ISO_T.test(v)) {
    const [h, m, s] = v.split(":").map(Number);
    return (h! * 3600 + m! * 60 + s!) / 86_400;
  }
  return null;
}

export type Check = {
  where: string;
  ycsv: string;
  a1Back: string;
  a1Original: string;
  roundTripText: boolean;
  cached: unknown;
  engine: unknown;
  match: boolean;
};

function norm(v: unknown): unknown {
  if (v instanceof Date) return (v.getTime() - EPOCH) / 86_400_000;
  if (v instanceof Error) return v.message;
  if (Array.isArray(v)) return v.length === 1 ? norm(v[0]) : JSON.stringify(v);
  return v;
}

function same(engine: unknown, cached: unknown): boolean {
  const e = norm(engine);
  if (typeof cached === "number" && typeof e === "number") return Math.abs(cached - e) <= 1e-9 * Math.max(1, Math.abs(cached)) || Math.abs(cached - e) < 1e-6;
  if (typeof cached === "number" && cached === 42 && e === "#N/A") return true; // SheetJS stores #N/A as 42
  if (typeof cached === "boolean") return e === cached;
  if (typeof cached === "string" && typeof e === "string") return cached === e;
  if (typeof cached === "number" && cached === 7 && e === "#DIV/0!") return true; // SheetJS error code 7
  return false;
}

/** Undo the per-formula text differences that do not change meaning. */
const canon = (f: string) => f.replace(/_xlfn\.(_xlws\.)?/g, "").replace(/\s+/g, "").toUpperCase();

export function evaluateImport(imp: ImportResult, defs: Map<string, string>): Check[] {
  return evaluateImportFull(imp, defs).checks;
}

/** Checks plus the engine's value for every cell (grid row 1 = index 0). */
export function evaluateImportFull(imp: ImportResult, defs: Map<string, string>): { checks: Check[]; values: unknown[][][] } {
  const evalNames = new Map<string, string>();
  for (const [key, ycsv] of defs) {
    // Range defs inline as their A1 range for the engine (it only inlines scalar defs).
    const owner = 0;
    evalNames.set(key, ycsvToA1(ycsv.replace(/^=/, ""), { sheets: imp.sheets, self: owner, names: new Map(), sheetName: (i) => `s${i}` }).text.replace(/\$/g, ""));
  }
  const excelNames = new Map<string, string>();
  for (const [lower, key] of imp.names) excelNames.set(key, lower.toUpperCase());

  const sheets: ParsedSheet[] = imp.grids.map((grid, si) => {
    const width = Math.max(1, ...grid.map((r) => r.length));
    const toEngine = (v: string, r: number, c: number) => {
      if (v.startsWith("=")) {
        const a1 = ycsvToA1(v.slice(1), { sheets: imp.sheets, self: si, names: evalNames, sheetName: (i) => `s${i}` }).text;
        return `=${a1.replace(/\$/g, "")}`;
      }
      if (v.startsWith("'")) return v.slice(1);
      const serial = isoToSerial(v);
      void r;
      void c;
      return serial === null ? v : String(serial);
    };
    const all = grid.map((row, r) => Array.from({ length: width }, (_, c) => toEngine(row[c] ?? "", r, c)));
    const refs = Array.from({ length: width }, (_, c) => colLetters(c));
    return {
      ref: `s${si}`,
      name: `s${si}`,
      columnSettings: refs.map((ref) => ({ ref, name: ref })),
      defs: {},
      refs,
      headers: all[0] ?? refs.map(() => ""),
      rows: all.slice(1),
      hadHeader: true,
    };
  });
  const wb: ParsedWorkbook = { version: 1, defs: {}, sheets, warnings: [] };
  const computed = evaluateWorkbook(wb);

  const checks = imp.formulas.map((f) => {
    const cell = computed[f.sheet]?.[f.row - 1]?.[f.col];
    const a1Back = ycsvToA1(f.ycsv, { sheets: imp.sheets, self: f.sheet, names: excelNames }).text;
    const engine = cell ? (cell.error ? cell.display : cell.value) : undefined;
    return {
      where: `${imp.sheets[f.sheet]!.name}!${colLetters(f.col)}${f.row}`,
      ycsv: `=${f.ycsv}`,
      a1Back: `=${a1Back}`,
      a1Original: `=${f.a1}`,
      roundTripText: canon(a1Back) === canon(f.a1 ?? ""),
      cached: f.cached,
      engine: norm(engine),
      match: f.cached === undefined ? false : same(engine, f.cached),
    };
  });
  const values = computed.map((sheet) => sheet.map((row) => row.map((c) => (c.error ? c.display : norm(c.value)))));
  return { checks, values };
}
