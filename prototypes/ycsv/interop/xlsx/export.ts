// YCSV (spike 11 amended form) → XLSX / ODS / CSV. Two writers:
//   - SheetJS CE: xlsx + ods + csv, values/formulas/formats/merges/widths/names/notes/hidden
//   - exceljs:    xlsx only, adds bold/fill, frozen panes and data validation
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import YAML from "yaml";
import { isoToSerial } from "./evaluate";
import { colLetters, rowNumbers, ycsvToA1, type SheetCols } from "./translate";

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
  /** Sheet-level validation: `at` = address (P29 ref grammar), rule fields as §3.1.2. */
  validate?: { at: string; list?: string | string[]; range?: { min: number; max: number; integer?: boolean } }[];
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
  // P26: trailing all-empty rows carry no meaning (also makes an empty body read as no rows).
  const trim = (rs: string[][]) => {
    while (rs.length && rs[rs.length - 1]!.every((v) => v === "")) rs.pop();
    return rs;
  };
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
        bodies.push(trim(rows));
        rows = [];
        cell = "";
      } else endRow();
      i += 1;
    } else (cell += ch), (i += 1);
  }
  if (cell !== "" || row.length) endRow();
  bodies.push(trim(rows));
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
  const sheets = p.fm.sheets.map((s, i) => ({ name: s.name ?? s.ref, ref: s.ref, refs: (s.columns ?? []).map((c, ci) => String(c.ref ?? colLetters(ci))), rows: rowNumbers(p.bodies[i] ?? [], !!s.header) }));
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

/**
 * Frontmatter address (P29, accepted in changed form: the formula ref grammar, `product0:totaal0`,
 * `'Prijs incl. BTW'3`, a bare ref = the whole column) → A1 range of sheet si. An address that
 * names no cell of the sheet is an error, not a silent miss.
 */
function addrToA1(addr: string, si: number, sheets: SheetCols[]): string {
  const bare = /^\$?([\p{L}_][\p{L}\p{N}_]*)$/u.exec(addr);
  const src = bare && sheets[si]!.refs.some((r) => r.toLowerCase() === bare[1]!.toLowerCase()) ? `${bare[1]}:${bare[1]}` : addr;
  const t = ycsvToA1(src, { sheets, self: si, names: new Map() });
  const a1 = t.text.replaceAll("$", "");
  if (t.issues.length || !/^[A-Z]+\d*(:[A-Z]+\d*)?$/.test(a1)) throw new Error(`frontmatter address "${addr}" (sheet ${sheets[si]!.ref}) is not a cell or range: ${t.issues.map((i) => i.what).join("; ") || a1}`);
  return a1;
}

/** Grid cells (r,c, 0-based) covered by an A1 cell, range or whole-column range, clipped to the body. */
function cover(a1: string, height: number): [number, number][] {
  const [s0, e0 = s0] = a1.split(":") as [string, string?];
  const p = (x: string, end: boolean) => {
    const m = /^([A-Z]+)(\d*)$/.exec(x)!;
    return { c: XLSX.utils.decode_col(m[1]!), r: m[2] ? Number(m[2]) - 1 : end ? height - 1 : 0 };
  };
  const s = p(s0, false);
  const e = p(e0!, true);
  const out: [number, number][] = [];
  for (let r = s.r; r <= Math.min(e.r, height - 1); r++) for (let c = s.c; c <= e.c; c++) out.push([r, c]);
  return out;
}

/** `cells` / `notes` keyed by grid position. Later keys win, like YAML mapping order. */
function byCell<T>(o: Record<string, T> | undefined, si: number, sheets: SheetCols[], height: number): Map<string, T> {
  const m = new Map<string, T>();
  for (const [k, v] of Object.entries(o ?? {})) for (const [r, c] of cover(addrToA1(k, si, sheets), height)) m.set(`${r},${c}`, v);
  return m;
}

/** Per-cell format: `cells.<address>` wins over the column. */
function formatFor(s: SheetFm, cell: Record<string, unknown> | undefined, c: number): Record<string, unknown> | undefined {
  if (cell && typeof cell.type === "string") return cell;
  const col = s.columns?.[c];
  return col && typeof col.type === "string" && col.type !== "string" ? col : undefined;
}

/**
 * `values` (engine results, grid row 1 = index 0) are written as cached values. They are
 * required: SheetJS CE writes a formula without a value as `of:=#NUM!` in ODS.
 */
/** The `cells` entry that covers grid cell (r, c) of sheet si, for callers outside the exporters. */
export function cellAt(p: Parsed, si: number, r: number, c: number): Record<string, unknown> | undefined {
  const { sheets } = context(p);
  return byCell(p.fm.sheets[si]!.cells, si, sheets, (p.bodies[si] ?? []).length).get(`${r},${c}`);
}

export function toSheetJS(p: Parsed, values?: unknown[][][]): XLSX.WorkBook {
  const { sheets, names } = context(p);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Names: [], Sheets: [] };
  p.fm.sheets.forEach((s, si) => {
    const ws: XLSX.WorkSheet = {};
    const body = p.bodies[si] ?? [];
    const cellsAt = byCell(s.cells, si, sheets, body.length);
    const notesAt = byCell(s.notes, si, sheets, body.length);
    let maxC = 0;
    body.forEach((row, r) => {
      row.forEach((v, c) => {
        if (v === "") return;
        maxC = Math.max(maxC, c);
        const addr = XLSX.utils.encode_cell({ r, c });
        if (s.header && r === 0) {
          ws[addr] = { t: "s", v }; // C1: the header text is the display name
          return;
        }
        const fmt = formatFor(s, cellsAt.get(`${r},${c}`), c);
        if (v.startsWith("=")) {
          const a1 = ycsvToA1(v.slice(1), { sheets, self: si, names }).text;
          const z = excelCode(fmt);
          const val = values?.[si]?.[r]?.[c];
          const cached: Partial<XLSX.CellObject> =
            typeof val === "number" ? { t: "n", v: val } : typeof val === "boolean" ? { t: "b", v: val } : typeof val === "string" && /^#[A-Z/0!?]+$/.test(val) ? { t: "e", v: ({ "#DIV/0!": 7, "#N/A": 42, "#VALUE!": 15, "#REF!": 23, "#NAME?": 29, "#NUM!": 36 } as Record<string, number>)[val] ?? 15 } : typeof val === "string" ? { t: "s", v: val } : { t: "n", v: 0 };
          ws[addr] = { ...cached, f: addXlfn(a1), ...(z ? { z } : {}) } as XLSX.CellObject;
        } else ws[addr] = literal(v, fmt);
        const note = notesAt.get(`${r},${c}`);
        if (note) (ws[addr] as XLSX.CellObject).c = [{ a: "", t: note }] as XLSX.Comments;
      });
    });
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, body.length - 1), c: maxC } });
    if (s.merges?.length) ws["!merges"] = s.merges.map((m) => XLSX.utils.decode_range(addrToA1(m, si, sheets)));
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
    const height = (p.bodies[si] ?? []).length;
    const cellsAt = byCell(s.cells, si, sheets, height);
    const notesAt = byCell(s.notes, si, sheets, height);
    (p.bodies[si] ?? []).forEach((row, r) => {
      row.forEach((v, c) => {
        if (v === "") return;
        const addr = `${colLetters(c)}${r + 1}`;
        const cell = ws.getCell(addr);
        if (s.header && r === 0) {
          cell.value = v; // C1: the header text is the display name
        } else {
          const fmt = formatFor(s, cellsAt.get(`${r},${c}`), c);
          if (v.startsWith("=")) cell.value = { formula: addXlfn(ycsvToA1(v.slice(1), { sheets, self: si, names }).text) } as ExcelJS.CellFormulaValue;
          else {
            const lit = literal(v, fmt);
            cell.value = lit.t === "n" && fmt && ["date", "datetime"].includes(String(fmt.type)) ? new Date(Date.UTC(1899, 11, 30) + Number(lit.v) * 86_400_000) : (lit.v as ExcelJS.CellValue);
          }
          const z = excelCode(fmt);
          if (z) cell.numFmt = z;
        }
        const st = cellsAt.get(`${r},${c}`)?.style;
        if (st?.bold) cell.font = { bold: true };
        if (st?.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${st.fill.slice(1).toUpperCase()}` } };
        const note = notesAt.get(`${r},${c}`);
        if (note) cell.note = note;
      });
    });
    for (const m of s.merges ?? []) ws.mergeCells(addrToA1(m, si, sheets));
    for (const v of s.validate ?? []) {
      const rule: ExcelJS.DataValidation | null = v.list
        ? { type: "list", allowBlank: true, formulae: [Array.isArray(v.list) ? `"${v.list.join(",")}"` : ycsvToA1(v.list.replace(/^=/, ""), { sheets, self: si, names }).text] }
        : v.range
          ? { type: v.range.integer ? "whole" : "decimal", operator: "between", allowBlank: true, formulae: [v.range.min, v.range.max] }
          : null;
      if (!rule) continue;
      for (const [r, c] of cover(addrToA1(v.at, si, sheets), height)) ws.getCell(r + 1, c + 1).dataValidation = rule;
    }
  });
  for (const [k, v] of Object.entries(p.fm.defs ?? {})) wb.definedNames.add(ycsvToA1(String(v).replace(/^=/, ""), { sheets, self: 0, names: new Map() }).text, k.toUpperCase());
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV export of one sheet: canonical values (ISO dates, `.` decimals), formulas as values. */
export function toCsv(rows: string[][]): string {
  return `${rows.map((r) => r.map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(",")).join("\r\n")}\r\n`;
}
