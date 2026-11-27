// YCSV (spike 11 amended form) → XLSX / ODS / CSV. Two writers:
//   - SheetJS CE: xlsx + ods + csv, values/formulas/formats/merges/widths/names/notes/hidden
//   - exceljs:    xlsx only, adds bold/fill, frozen panes and data validation
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import YAML from "yaml";
import { isoToSerial } from "./evaluate";
import { colLetters, ycsvToA1, type SheetCols } from "./translate";

type SheetFm = {
  ref: string;
  name?: string;
  header?: boolean;
  hidden?: boolean;
  freeze?: { rows: number; columns: number };
  columns?: Record<string, unknown>[];
  merges?: string[];
  notes?: Record<string, string>;
  cells?: Record<string, Record<string, unknown> & { style?: { bold?: boolean; fill?: string } }>;
  defs?: Record<string, string>;
  validate?: { range: string; list?: string | string[]; range_value?: { min: number; max: number; integer?: boolean } }[];
};

export type Parsed = { fm: { defs?: Record<string, string>; sheets: SheetFm[] }; bodies: string[][][] };

/** Minimal reader for the amended format (quote-aware block split, RFC 4180 CSV). */
export function readAmended(text: string): Parsed {
  const end = text.indexOf("\n---\n", 4);
  const fm = YAML.parse(text.slice(4, end)) as Parsed["fm"];
  const rest = text.slice(end + 5);
  const bodies: string[][][] = [];
  let rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  let i = 0;
  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
  };
  while (i < rest.length) {
    const ch = rest[i]!;
    if (q) {
      if (ch === '"' && rest[i + 1] === '"') (cell += '"'), (i += 2);
      else if (ch === '"') (q = false), (i += 1);
      else (cell += ch), (i += 1);
      continue;
    }
    if (ch === '"' && cell === "") (q = true), (i += 1);
    else if (ch === ",") row.push(cell), (cell = ""), (i += 1);
    else if (ch === "\n") {
      if (row.length === 0 && cell === "---") {
        bodies.push(rows);
        rows = [];
        cell = "";
      } else endRow();
      i += 1;
    } else (cell += ch), (i += 1);
  }
  if (cell !== "" || row.length) endRow();
  bodies.push(rows);
  return { fm, bodies };
}

const XLFN = new Set(["XLOOKUP", "XMATCH", "TEXTJOIN", "CONCAT", "IFS", "SWITCH", "MAXIFS", "MINIFS", "UNIQUE", "SORT", "SORTBY", "FILTER", "SEQUENCE", "LET", "LAMBDA", "IFNA", "DAYS", "ISOWEEKNUM"]);
const XLWS = new Set(["FILTER", "SORT"]);

/** Excel needs `_xlfn.` on functions newer than 2007, or it shows #NAME?. */
export function addXlfn(f: string): string {
  return f.replace(/("(?:[^"]|"")*")|\b([A-Z][A-Z0-9.]*)(?=\()/g, (m, str, fn) => (str ? str : XLFN.has(fn) ? `_xlfn.${XLWS.has(fn) ? "_xlws." : ""}${fn}` : m));
}

/** Intl options → Excel format code, for cells that have no `excel_format`. */
export function excelCode(f: Record<string, unknown> | undefined): string | undefined {
  if (!f) return undefined;
  if (typeof f.excel_format === "string") return f.excel_format;
  const d = Number(f.maximumFractionDigits ?? (f.type === "currency" ? 2 : 0));
  const dec = d > 0 ? `.${"0".repeat(d)}` : "";
  switch (f.type) {
    case "currency":
      return `"${{ EUR: "€", USD: "$", GBP: "£" }[String(f.currency)] ?? String(f.currency)}"#,##0${dec}`;
    case "percent":
      return `0${dec}%`;
    case "date":
      return "yyyy-mm-dd";
    case "time":
      return "hh:mm:ss";
    case "datetime":
      return "yyyy-mm-dd hh:mm:ss";
    case "number":
      return f.notation === "scientific" ? `0${dec}E+00` : `${f.useGrouping ? "#,##0" : "0"}${dec}`;
    default:
      return undefined;
  }
}

function context(p: Parsed): { sheets: SheetCols[]; names: Map<string, string> } {
  const sheets = p.fm.sheets.map((s, i) => ({ name: s.name ?? s.ref, ref: s.ref, refs: (s.columns ?? []).map((c, ci) => String(c.ref ?? colLetters(ci))) }));
  void p.bodies;
  const names = new Map<string, string>();
  for (const k of Object.keys(p.fm.defs ?? {})) names.set(k, k.toUpperCase());
  p.fm.sheets.forEach((s) => Object.keys(s.defs ?? {}).forEach((k) => names.set(k, k.toUpperCase())));
  return { sheets, names };
}

function literal(v: string, fmt: Record<string, unknown> | undefined): XLSX.CellObject {
  if (v.startsWith("'")) return { t: "s", v: v.slice(1) };
  if (v === "true" || v === "false") return { t: "b", v: v === "true" };
  const serial = fmt && ["date", "time", "datetime"].includes(String(fmt.type)) ? isoToSerial(v) : null;
  if (serial !== null) return { t: "n", v: serial, z: excelCode(fmt) };
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)) return { t: "n", v: Number(v), z: excelCode(fmt) };
  return { t: "s", v };
}

/** Per-cell format: `cells.<A1>` wins over the column. */
function formatFor(s: SheetFm, addr: string, c: number): Record<string, unknown> | undefined {
  const cell = s.cells?.[addr];
  if (cell && typeof cell.type === "string") return cell;
  const col = s.columns?.[c];
  return col && typeof col.type === "string" && col.type !== "string" ? col : undefined;
}

/**
 * `values` (engine results, grid row 1 = index 0) are written as cached values. They are
 * required: SheetJS CE writes a formula without a value as `of:=#NUM!` in ODS.
 */
export function toSheetJS(p: Parsed, values?: unknown[][][]): XLSX.WorkBook {
  const { sheets, names } = context(p);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Names: [], Sheets: [] };
  p.fm.sheets.forEach((s, si) => {
    const ws: XLSX.WorkSheet = {};
    const body = p.bodies[si] ?? [];
    let maxC = 0;
    body.forEach((row, r) => {
      row.forEach((v, c) => {
        if (v === "") return;
        maxC = Math.max(maxC, c);
        const addr = XLSX.utils.encode_cell({ r, c });
        if (s.header && r === 0) {
          ws[addr] = { t: "s", v: String(s.columns?.[c]?.name ?? v) };
          return;
        }
        const fmt = formatFor(s, addr, c);
        if (v.startsWith("=")) {
          const a1 = ycsvToA1(v.slice(1), { sheets, self: si, names }).text;
          const z = excelCode(fmt);
          const val = values?.[si]?.[r]?.[c];
          const cached: Partial<XLSX.CellObject> =
            typeof val === "number" ? { t: "n", v: val } : typeof val === "boolean" ? { t: "b", v: val } : typeof val === "string" && /^#[A-Z/0!?]+$/.test(val) ? { t: "e", v: ({ "#DIV/0!": 7, "#N/A": 42, "#VALUE!": 15, "#REF!": 23, "#NAME?": 29, "#NUM!": 36 } as Record<string, number>)[val] ?? 15 } : typeof val === "string" ? { t: "s", v: val } : { t: "n", v: 0 };
          ws[addr] = { ...cached, f: addXlfn(a1), ...(z ? { z } : {}) } as XLSX.CellObject;
        } else ws[addr] = literal(v, fmt);
        const note = s.notes?.[addr];
        if (note) (ws[addr] as XLSX.CellObject).c = [{ a: "", t: note }] as XLSX.Comments;
      });
    });
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, body.length - 1), c: maxC } });
    if (s.merges?.length) ws["!merges"] = s.merges.map((m) => XLSX.utils.decode_range(m));
    ws["!cols"] = (s.columns ?? []).map((c) => ({ ...(c.width ? { wpx: Number(c.width) } : {}), ...(c.hidden ? { hidden: true } : {}) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name ?? s.ref);
    wb.Workbook!.Sheets!.push({ name: s.name ?? s.ref, Hidden: s.hidden ? 1 : 0 });
    for (const [k, v] of Object.entries(s.defs ?? {})) wb.Workbook!.Names!.push({ Name: k.toUpperCase(), Sheet: si, Ref: ycsvToA1(v.replace(/^=/, ""), { sheets, self: si, names: new Map() }).text });
  });
  for (const [k, v] of Object.entries(p.fm.defs ?? {})) wb.Workbook!.Names!.push({ Name: k.toUpperCase(), Ref: ycsvToA1(String(v).replace(/^=/, ""), { sheets, self: 0, names: new Map() }).text });
  return wb;
}

export async function toExcelJS(p: Parsed): Promise<Buffer> {
  const { sheets, names } = context(p);
  const wb = new ExcelJS.Workbook();
  p.fm.sheets.forEach((s, si) => {
    const ws = wb.addWorksheet(s.name ?? s.ref, { state: s.hidden ? "hidden" : "visible", ...(s.freeze ? { views: [{ state: "frozen", xSplit: s.freeze.columns, ySplit: s.freeze.rows }] } : {}) });
    (s.columns ?? []).forEach((c, ci) => {
      const col = ws.getColumn(ci + 1);
      if (c.width) col.width = Number(c.width) / 7;
      if (c.hidden) col.hidden = true;
    });
    (p.bodies[si] ?? []).forEach((row, r) => {
      row.forEach((v, c) => {
        if (v === "") return;
        const addr = `${colLetters(c)}${r + 1}`;
        const cell = ws.getCell(addr);
        if (s.header && r === 0) {
          cell.value = String(s.columns?.[c]?.name ?? v);
        } else {
          const fmt = formatFor(s, addr, c);
          if (v.startsWith("=")) cell.value = { formula: addXlfn(ycsvToA1(v.slice(1), { sheets, self: si, names }).text) } as ExcelJS.CellFormulaValue;
          else {
            const lit = literal(v, fmt);
            cell.value = lit.t === "n" && fmt && ["date", "datetime"].includes(String(fmt.type)) ? new Date(Date.UTC(1899, 11, 30) + Number(lit.v) * 86_400_000) : (lit.v as ExcelJS.CellValue);
          }
          const z = excelCode(fmt);
          if (z) cell.numFmt = z;
        }
        const st = s.cells?.[addr]?.style;
        if (st?.bold) cell.font = { bold: true };
        if (st?.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${st.fill.slice(1).toUpperCase()}` } };
        if (s.notes?.[addr]) cell.note = s.notes[addr];
      });
    });
    for (const m of s.merges ?? []) ws.mergeCells(m);
    for (const v of s.validate ?? []) {
      const rule: ExcelJS.DataValidation | null = v.list
        ? { type: "list", allowBlank: true, formulae: [Array.isArray(v.list) ? `"${v.list.join(",")}"` : ycsvToA1(v.list.replace(/^=/, ""), { sheets, self: si, names }).text] }
        : v.range_value
          ? { type: v.range_value.integer ? "whole" : "decimal", operator: "between", allowBlank: true, formulae: [v.range_value.min, v.range_value.max] }
          : null;
      if (!rule) continue;
      const range = XLSX.utils.decode_range(v.range);
      for (let r = range.s.r; r <= range.e.r; r++) for (let c = range.s.c; c <= range.e.c; c++) ws.getCell(r + 1, c + 1).dataValidation = rule;
    }
  });
  for (const [k, v] of Object.entries(p.fm.defs ?? {})) wb.definedNames.add(ycsvToA1(String(v).replace(/^=/, ""), { sheets, self: 0, names: new Map() }).text, k.toUpperCase());
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV export of one sheet: canonical values (ISO dates, `.` decimals), formulas as values. */
export function toCsv(rows: string[][]): string {
  return `${rows.map((r) => r.map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(",")).join("\r\n")}\r\n`;
}
