// XLSX / ODS → YCSV importer (spike 11). SheetJS CE reads the workbook; a small raw-XML
// reader adds what CE does not expose for XLSX (frozen panes, data validation, bold).
// Output follows the spec as amended by the spike 11 proposals (P1–P20 in ycsv-spec-v1.md).
import * as XLSX from "xlsx";
import YAML from "yaml";
import { a1ToYcsv, colLetters, emitRef, openFormulaToA1, type Issue, type SheetCols } from "./translate";

export type Outcome = "survives" | "degrades" | "lost";
export type LogEntry = { feature: string; outcome: Outcome; detail: string };

export type ImportedCell = { sheet: number; row: number; col: number; ycsv: string; a1?: string; cached?: unknown; z?: string };
export type ImportResult = {
  text: string;
  log: LogEntry[];
  sheets: SheetCols[];
  /** Every formula cell, with the cached value the producing app stored. */
  formulas: ImportedCell[];
  /** Grid of raw YCSV cell strings per sheet (row 0 = grid row 1). */
  grids: string[][][];
  names: Map<string, string>;
};

// --- number formats ------------------------------------------------------------------------

type Fmt = Record<string, unknown> & { type: string };

const CURRENCY: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", "¥": "JPY", CHF: "CHF" };

function stripLiterals(code: string): string {
  return code.replace(/"[^"]*"/g, (q) => q.replace(/[0#%dmyhs]/gi, "")).replace(/\\./g, "");
}

/** Map an Excel number-format code to YCSV type + Intl options. `excel_format` keeps the code. */
export function classifyFormat(code: string | undefined, value: unknown): Fmt | null {
  if (!code || code === "General" || code === "@") return null;
  const first = code.split(";")[0]!;
  if (XLSX.SSF.is_date(code)) {
    const plain = stripLiterals(first).replace(/\[[^\]]*\]/g, "");
    const hasDate = /[dy]/i.test(plain) || /m{3,}/i.test(plain);
    const hasTime = /[hs]/i.test(plain);
    return { type: hasDate && hasTime ? "datetime" : hasTime ? "time" : "date" };
  }
  const plain = stripLiterals(first);
  const dec = /\.([0#]+)/.exec(first)?.[1]?.length ?? 0;
  const frac = { minimumFractionDigits: dec, maximumFractionDigits: dec };
  if (/%/.test(plain)) return { type: "percent", ...frac };
  const cur = /\[\$([A-Z]{3})/.exec(first)?.[1] ?? Object.entries(CURRENCY).find(([sym]) => first.includes(sym))?.[1];
  if (cur) return { type: "currency", currency: cur, ...frac };
  if (/E\+/i.test(plain)) return { type: "number", notation: "scientific", ...frac };
  if (/[0#]/.test(plain)) return { type: "number", ...frac, ...(plain.includes(",") ? { useGrouping: true } : {}) };
  void value;
  return null;
}

const fmtKey = (f: Fmt | null) => (f ? JSON.stringify(f) : "");

// --- literal values ------------------------------------------------------------------------

const EPOCH = Date.UTC(1899, 11, 30);

/** Days between the 1900 and 1904 date systems (Numbers files use 1904). */
export const DATE1904_OFFSET = 1462;

export function serialToIso(serial: number, type: string): string {
  const ms = Math.round(serial * 86_400_000);
  const d = new Date(EPOCH + ms);
  const iso = d.toISOString();
  if (type === "date") return iso.slice(0, 10);
  if (type === "time") return iso.slice(11, 19);
  return iso.slice(0, 19);
}

/** P5: text that would read back as something else gets a leading apostrophe. */
export function escapeText(v: string, columnIsText: boolean): string {
  if (v.startsWith("=") || v.startsWith("'")) return `'${v}`;
  if (!columnIsText && (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v.trim()) || /^(true|false)$/i.test(v) || /^\(.*\)$/.test(v))) return `'${v}`;
  return v;
}

/** Excel keeps 15 significant digits; this also removes float noise (.numbers gives 0.6000000000000001). */
function canonicalNumber(n: number): string {
  if (Object.is(n, -0)) return "0";
  return String(Number(n.toPrecision(15)));
}

// --- raw XLSX parts (frozen panes, validation, bold) -----------------------------------------

type Raw = { freeze?: { rows: number; columns: number }; validations: { sqref: string; type: string; f1?: string; f2?: string; op?: string }[]; bold: Set<string>; tab?: string };

function rawParts(wb: XLSX.WorkBook): Raw[] {
  const files = (wb as unknown as { files?: Record<string, { content: Uint8Array | string }> }).files;
  if (!files) return [];
  const text = (name: string) => {
    const f = files[name];
    if (!f) return "";
    return typeof f.content === "string" ? f.content : new TextDecoder().decode(f.content);
  };
  const rels = text("xl/_rels/workbook.xml.rels");
  const book = text("xl/workbook.xml");
  const styles = text("xl/styles.xml");
  const fonts = [...(/<fonts[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)?.[1] ?? "").matchAll(/<font>([\s\S]*?)<\/font>|<font\/>/g)].map((m) => /<b(\s+val="(true|1)")?\s*\/>/.test(m[1] ?? ""));
  const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "").matchAll(/<xf\b[^>]*?fontId="(\d+)"/g)].map((m) => fonts[Number(m[1])] ?? false);
  const sheets = [...book.matchAll(/<sheet\b[^>]*?r:id="([^"]+)"/g)].map((m) => m[1]!);
  return sheets.map((rid) => {
    const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels);
    const path = `xl/${(target?.[1] ?? target?.[2] ?? "").replace(/^\/?xl\//, "")}`;
    const xml = text(path);
    const pane = /<pane\b([^>]*)\/>/.exec(xml)?.[1] ?? "";
    const frozen = /state="frozen"/.test(pane);
    const raw: Raw = { validations: [], bold: new Set() };
    if (frozen) raw.freeze = { rows: Number(/ySplit="(\d+)"/.exec(pane)?.[1] ?? 0), columns: Number(/xSplit="(\d+)"/.exec(pane)?.[1] ?? 0) };
    for (const m of xml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)) {
      const attrs = m[1]!;
      raw.validations.push({
        sqref: /sqref="([^"]+)"/.exec(attrs)?.[1] ?? "",
        type: /type="([^"]+)"/.exec(attrs)?.[1] ?? "any",
        op: /operator="([^"]+)"/.exec(attrs)?.[1],
        f1: /<formula1>([\s\S]*?)<\/formula1>/.exec(m[2]!)?.[1]?.replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
        f2: /<formula2>([\s\S]*?)<\/formula2>/.exec(m[2]!)?.[1],
      });
    }
    for (const m of xml.matchAll(/<c\b[^>]*?r="([A-Z]+\d+)"[^>]*?\bs="(\d+)"/g)) if (xfs[Number(m[2])]) raw.bold.add(m[1]!);
    for (const m of xml.matchAll(/<c\b[^>]*?\bs="(\d+)"[^>]*?r="([A-Z]+\d+)"/g)) if (xfs[Number(m[1])]) raw.bold.add(m[2]!);
    raw.tab = /<tabColor\b[^>]*rgb="([0-9A-F]{8})"/.exec(xml)?.[1];
    return raw;
  });
}

// --- refs ------------------------------------------------------------------------------------

function slug(s: string): string {
  return s.normalize("NFC").toLowerCase().trim().replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "");
}

function unique(base: string, taken: Set<string>): string {
  let r = base;
  while (taken.has(r)) r = `${r}_`;
  taken.add(r);
  return r;
}

// --- main ------------------------------------------------------------------------------------

export function importWorkbook(data: Uint8Array, opts: { source: string }): ImportResult {
  // sheetStubs: without it SheetJS drops formula cells that have no cached value (Numbers writes =1/0 that way).
  const wb = XLSX.read(data, { cellFormula: true, cellNF: true, cellStyles: true, cellDates: false, bookFiles: true, sheetStubs: true });
  const isOds = wb.bookType === "ods" || opts.source.endsWith(".ods");
  const isNumbers = (wb.bookType as string) === "numbers" || opts.source.endsWith(".numbers");
  const allRaws = rawParts(wb);
  const log: LogEntry[] = [];
  const L = (feature: string, outcome: Outcome, detail: string) => log.push({ feature, outcome, detail });
  // 1904 date system (every .numbers file): serials are 1462 days smaller than in 1900 files.
  const dateOffset = wb.Workbook?.WBProps?.date1904 ? DATE1904_OFFSET : 0;
  if (dateOffset) L("1904 date system", "survives", "serials shifted by 1462 days before converting to ISO dates");

  // Numbers XLSX export: a leading "Export Summary" sheet maps Numbers sheet/table → worksheet.
  const first = wb.Sheets[wb.SheetNames[0]!];
  const numbersXlsx = !isNumbers && /^This document was exported from Numbers/.test(String((first?.B3 as XLSX.CellObject | undefined)?.v ?? ""));
  const keep = wb.SheetNames.map((_, i) => !(numbersXlsx && i === 0));
  if (numbersXlsx) {
    const rows = XLSX.utils.sheet_to_json<string[]>(first!, { header: 1, defval: "" });
    const tables = rows.filter((r) => r.some(Boolean) && r[2]).slice(1).map((r) => `${r[1]} → ${r[2]}`);
    L("Numbers export summary sheet", "lost", `dropped; tables: ${tables.join(", ")}`);
    L("Numbers: some formulas in error", "lost", "Numbers' XLSX export writes some error formulas as empty cells (seen: TEXT(date), NA()); =1/0 is kept without a value. Not detectable on import");
    L("Numbers: named ranges and hidden sheets", "lost", "Numbers' XLSX export inlines ranges and shows hidden sheets");
  }
  if (isNumbers) {
    L("formulas", "lost", ".numbers via SheetJS CE: values only. Every formula cell is imported as its last computed value and will not update. Fallback: in Numbers, File → Export To → Excel keeps formulas");
    L("number formats", "degrades", ".numbers via SheetJS CE: only dates keep a format; currency, percent and decimals become plain numbers");
    L("Numbers tables", "degrades", ".numbers: each table becomes a sheet; table names are lost (second table on a sheet becomes '<sheet>_1')");
  }
  const sheetNames = wb.SheetNames.filter((_, i) => keep[i]);
  const raws = allRaws.filter((_, i) => keep[i]);

  // Sheet refs + header detection + column refs, before any formula is translated.
  const takenSheets = new Set<string>();
  const meta = sheetNames.map((name, si) => {
    const ws = wb.Sheets[name]!;
    const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
    // Trailing columns without any value (Numbers tables carry spare columns) are not part of the sheet.
    let lastCol = -1;
    for (const [k, c] of Object.entries(ws)) {
      if (k.startsWith("!")) continue;
      const cell = c as XLSX.CellObject;
      if (cell.t !== "z" || cell.f) lastCol = Math.max(lastCol, XLSX.utils.decode_cell(k).c);
    }
    // Keep columns that carry meaning without a value: inside a merge, or hidden.
    for (const g of ws["!merges"] ?? []) lastCol = Math.max(lastCol, g.e.c);
    (ws["!cols"] ?? []).forEach((info, c) => {
      if (info?.hidden) lastCol = Math.max(lastCol, c);
    });
    const width = Math.min(range.e.c, lastCol) + 1;
    const height = range.e.r + 1;
    const row1 = Array.from({ length: width }, (_, c) => ws[XLSX.utils.encode_cell({ r: 0, c })] as XLSX.CellObject | undefined);
    const merged1 = (ws["!merges"] ?? []).some((m) => m.s.r === 0 && m.e.c > m.s.c);
    const header =
      height > 1 && width > 0 && !merged1 &&
      row1.every((c) => c && c.t === "s" && !c.f && String(c.v).trim() !== "") &&
      new Set(row1.map((c) => String(c!.v).trim().toLowerCase())).size === width;
    const taken = new Set<string>();
    const refs = Array.from({ length: width }, (_, c) => (header ? unique(slug(String(row1[c]!.v)) || colLetters(c), taken) : colLetters(c)));
    const ref = unique(slug(name) || `sheet${si + 1}`, takenSheets);
    return { name, ws, width, height, header, refs, ref };
  });
  const sheets: SheetCols[] = meta.map((m) => ({ name: m.name, ref: m.ref, refs: m.refs }));

  // Defined names → defs (P13). Sheet-scoped names become sheet defs.
  const names = new Map<string, string>();
  const bookDefs: Record<string, unknown> = {};
  const sheetDefs: Record<string, unknown>[] = meta.map(() => ({}));
  for (const n of wb.Workbook?.Names ?? []) {
    if (n.Name.startsWith("_xlnm.")) {
      L("autofilter / print areas", "lost", n.Name);
      continue;
    }
    names.set(n.Name.toLowerCase(), slug(n.Name));
  }
  for (const n of wb.Workbook?.Names ?? []) {
    if (n.Name.startsWith("_xlnm.")) continue;
    const ref = isOds ? openFormulaToA1(n.Ref.replace(/&apos;/g, "'")) : n.Ref;
    const t = a1ToYcsv(ref, { sheets, self: n.Sheet ?? 0, names });
    (n.Sheet !== undefined ? sheetDefs[n.Sheet]! : bookDefs)[slug(n.Name)] = `=${t.text}`;
    L("named ranges", t.issues.length ? "degrades" : "survives", `${n.Name} → ${slug(n.Name)}: =${t.text}`);
  }

  const formulas: ImportedCell[] = [];
  const grids: string[][][] = [];
  const frontSheets: Record<string, unknown>[] = [];
  const bodies: string[] = [];
  const hiddenInfo = (wb.Workbook?.Sheets ?? []).filter((_, i) => keep[i]);

  meta.forEach((m, si) => {
    const raw = raws[si];
    const grid: string[][] = Array.from({ length: m.height }, () => Array.from({ length: m.width }, () => ""));
    const cellFmt: (Fmt | null)[][] = Array.from({ length: m.height }, () => Array.from({ length: m.width }, () => null));
    const notes: Record<string, string> = {};
    const cellsFm: Record<string, Record<string, unknown>> = {};

    // Column formats: one shared format per column → column type; else per-cell (P9).
    const colFmt: (Fmt | null)[] = [];
    const colText: boolean[] = [];
    for (let c = 0; c < m.width; c++) {
      const keys = new Map<string, Fmt | null>();
      let texts = 0, others = 0;
      for (let r = m.header ? 1 : 0; r < m.height; r++) {
        const cell = m.ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        if (!cell || cell.t === "z" && !cell.f) continue;
        if (cell.t === "s" && !cell.f) {
          texts += 1;
          continue;
        }
        others += 1;
        const f = cell.t === "b" ? { type: "boolean" } : classifyFormat(cell.z as string | undefined, cell.v);
        keys.set(fmtKey(f), f);
      }
      colFmt.push(keys.size === 1 && texts === 0 ? [...keys.values()][0]! : null);
      colText.push(others === 0 && texts > 0);
    }

    for (let r = 0; r < m.height; r++) {
      for (let c = 0; c < m.width; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = m.ws[addr] as (XLSX.CellObject & { l?: { Target?: string } }) | undefined;
        if (!cell) continue;
        if (m.header && r === 0) {
          grid[r]![c] = m.refs[c]!;
          if (String(cell.v) !== m.refs[c]) L("header text", "survives", `${m.name}!${addr} "${cell.v}" → ref ${m.refs[c]} + name`);
          continue;
        }
        const fmt = cell.t === "b" ? { type: "boolean" } : classifyFormat(cell.z as string | undefined, cell.v);
        cellFmt[r]![c] = fmt;
        if (cell.c?.length) {
          notes[addr] = cell.c.map((x) => x.t).join("\n");
          L("comments / notes", "survives", `${m.name}!${addr} as plain-text note (P14)`);
          if (cell.c.some((x) => x.a)) L("comment authors", "lost", `${m.name}!${addr} author "${cell.c.map((x) => x.a).join(", ")}" dropped`);
        }
        let f = cell.f;
        if (f && isOds) f = openFormulaToA1(f);
        if (f && /^(TRUE|FALSE)\(\)$/i.test(f)) f = undefined; // LibreOffice writes boolean literals as TRUE()
        if (f && /^#N\/A$/.test(f)) f = "NA()";
        if (f) f = f.replace(/\b(TRUE|FALSE)\(\)/g, "$1"); // LibreOffice spells the constants as functions
        if (f) {
          if (f.includes("__xludf.DUMMYFUNCTION")) {
            // Google-only function: keep the cached value, keep the original text as a note.
            const inner = /__xludf\.DUMMYFUNCTION\("((?:[^"]|"")*)"\)/.exec(f)?.[1]?.replace(/""/g, '"') ?? f;
            grid[r]![c] = cell.t === "n" ? canonicalNumber(cell.v as number) : escapeText(String(cell.v ?? ""), true);
            cellsFm[addr] = { ...(cellsFm[addr] ?? {}), source_formula: `=${inner}` };
            L("Google-only functions", "degrades", `${m.name}!${addr} =${inner} → cached value ${JSON.stringify(cell.v)}`);
            continue;
          }
          const t = a1ToYcsv(f.replace(/_xlfn\.(_xlws\.)?/g, ""), { sheets, self: si, names });
          grid[r]![c] = `=${t.text}`;
          formulas.push({ sheet: si, row: r + 1, col: c, ycsv: t.text, a1: f, cached: cell.t === "z" ? undefined : cell.v, z: cell.z as string | undefined });
          if (t.issues.length) for (const i of t.issues) L("formulas", i.kind === "lost" ? "lost" : "degrades", `${m.name}!${addr} ${i.what}`);
          continue;
        }
        if (cell.l?.Target) {
          grid[r]![c] = `=HYPERLINK("${cell.l.Target.replace(/"/g, '""')}","${String(cell.v).replace(/"/g, '""')}")`;
          L("hyperlinks", "survives", `${m.name}!${addr} → =HYPERLINK(…)`);
          continue;
        }
        if (cell.t === "e") {
          // Error literal (P20). .numbers errors come without a code; keep "an error" as =NA().
          const code = cell.w;
          grid[r]![c] = code === undefined || code === "#N/A" ? "=NA()" : `'${code}`;
          L("error values", code === "#N/A" ? "survives" : "degrades", `${m.name}!${addr} ${code ?? "error without code → =NA()"}`);
          continue;
        }
        if (cell.t === "b") grid[r]![c] = cell.v ? "true" : "false";
        else if (cell.t === "n") {
          const v = cell.v as number;
          if (fmt && (fmt.type === "date" || fmt.type === "time" || fmt.type === "datetime")) {
            const serial = v + dateOffset;
            // A "date" with a time part on day 0/1 is a time of day (Numbers stores times as 1900-01-01 hh:mm).
            const type = fmt.type === "date" && serial % 1 !== 0 ? (Math.floor(serial) <= 1 ? "time" : "datetime") : fmt.type;
            if (type !== fmt.type) L("dates and times", "degrades", `${m.name}!${addr} date-formatted value with a time part → ${type}`);
            grid[r]![c] = serialToIso(type === "time" ? serial % 1 : serial, type);
          }
          else grid[r]![c] = canonicalNumber(v);
        } else if (cell.t === "s") {
          const v = String(cell.v);
          grid[r]![c] = escapeText(v, colText[c]!);
          if ((cell as { r?: string }).r?.includes("<r>")) L("rich text", "degrades", `${m.name}!${addr} formatting runs dropped, text kept`);
        }
      }
    }

    // Per-cell formats where the column has none (P9).
    let perCell = 0;
    for (let r = m.header ? 1 : 0; r < m.height; r++)
      for (let c = 0; c < m.width; c++) {
        const f = cellFmt[r]![c];
        if (!f || colFmt[c]) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = m.ws[addr] as XLSX.CellObject;
        cellsFm[addr] = { ...(cellsFm[addr] ?? {}), ...f, ...(cell.z ? { excel_format: cell.z } : {}) };
        perCell += 1;
      }
    if (perCell) L("number formats", "survives", `${m.name}: ${perCell} per-cell formats (P9, mixed-type column)`);

    // Columns.
    const cols: Record<string, unknown>[] = m.refs.map((ref, c) => {
      const col: Record<string, unknown> = { ref };
      if (m.header) {
        const h = String((m.ws[XLSX.utils.encode_cell({ r: 0, c })] as XLSX.CellObject).v);
        if (h !== ref) col.name = h;
      }
      const f = colFmt[c];
      if (f) {
        Object.assign(col, f);
        const sample = (() => {
          for (let r = m.header ? 1 : 0; r < m.height; r++) {
            const cell = m.ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
            if (cell?.z && cell.z !== "General") return String(cell.z);
          }
          return undefined;
        })();
        if (sample) col.excel_format = sample;
        L("number formats", f.type === "date" || f.type === "datetime" ? "degrades" : "survives", `${m.name}.${ref}: ${sample ?? "boolean"} → type ${f.type}${f.type === "date" || f.type === "datetime" ? " (exact pattern only via excel_format; display follows reader locale)" : ""}`);
      } else if (colText[c]) col.type = "string";
      const info = m.ws["!cols"]?.[c];
      if (info?.wpx || info?.wch) {
        col.width = Math.round(info.wpx ?? (info.wch! * 7 + 5));
        L("column widths", "survives", `${m.name}.${ref} ${col.width}px`);
      }
      if (info?.hidden) {
        col.hidden = true;
        L("hidden columns", "survives", `${m.name}.${ref}`);
      }
      return col;
    });

    // Bold (from raw XML); fills from SheetJS CE style objects.
    if (raw) {
      for (const addr of raw.bold) {
        const { r, c } = XLSX.utils.decode_cell(addr);
        if (r >= m.height || c >= m.width) continue;
        cellsFm[addr] = { ...(cellsFm[addr] ?? {}), style: { ...((cellsFm[addr]?.style as object) ?? {}), bold: true } };
      }
      if (raw.bold.size) L("bold", "survives", `${m.name}: ${raw.bold.size} cells (raw XML, not SheetJS CE)`);
    } else L("bold", "lost", `${m.name}: not readable (SheetJS CE gives no fonts${isOds ? "; no raw parts for ODS" : ""})`);
    let fills = 0;
    for (let r = 0; r < m.height; r++)
      for (let c = 0; c < m.width; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const s = (m.ws[addr] as { s?: { patternType?: string; fgColor?: { rgb?: string } } } | undefined)?.s;
        if (s?.patternType === "solid" && s.fgColor?.rgb) {
          cellsFm[addr] = { ...(cellsFm[addr] ?? {}), style: { ...((cellsFm[addr]?.style as object) ?? {}), fill: `#${s.fgColor.rgb.slice(-6).toLowerCase()}` } };
          fills += 1;
        }
      }
    if (fills) L("fill colours", "survives", `${m.name}: ${fills} cells`);
    L("fonts, sizes, italic, alignment, borders", "lost", `${m.name}: spec has bold/fill/color/border only; CE exposes none of font size/colour/italic/alignment`);

    // Merges, freeze, validation, hidden, tab colour.
    const merges = (m.ws["!merges"] ?? []).map((g) => XLSX.utils.encode_range(g));
    if (merges.length) L("merged cells", "survives", `${m.name}: ${merges.join(", ")} (P10)`);
    if (raw?.freeze) L("frozen panes", "survives", `${m.name}: rows ${raw.freeze.rows}, columns ${raw.freeze.columns} (P11)`);
    else if (!raw) L("frozen panes", "lost", `${m.name}: not readable via SheetJS CE${isOds ? " (ODS settings.xml not exposed)" : ""}`);
    const validations: Record<string, unknown>[] = [];
    for (const v of raw?.validations ?? []) {
      const entry: Record<string, unknown> = { range: v.sqref };
      if (v.type === "list" && v.f1) entry.list = v.f1.startsWith('"') ? v.f1.slice(1, -1).split(",") : `=${a1ToYcsv(v.f1, { sheets, self: si, names }).text}`;
      else if ((v.type === "whole" || v.type === "decimal") && (v.op ?? "between") === "between") entry.range_value = { min: Number(v.f1), max: Number(v.f2), ...(v.type === "whole" ? { integer: true } : {}) };
      else {
        L("data validation", "lost", `${m.name} ${v.type} ${v.op ?? ""} ${v.sqref}`);
        continue;
      }
      validations.push(entry);
    }
    if (validations.length) L("data validation", "survives", `${m.name}: ${validations.length} rules (list from range, whole-number range) (P15)`);
    const hidden = hiddenInfo[si]?.Hidden;
    if (hidden) L("hidden sheets", "survives", `${m.name} (P17)`);
    if (raw?.tab) L("tab colour", "survives", `${m.name} #${raw.tab.slice(2)} (P17)`);
    const rowsH = (m.ws["!rows"] ?? []).filter((x) => x?.hpt || x?.hpx).length;
    if (rowsH) L("row heights", "lost", `${m.name}: ${rowsH} rows (fixed row height, product decision 6)`);
    L("conditional formatting", "lost", `${m.name}: not read (cellIs rules could map to column style IF(); not built in the spike)`);

    const entry: Record<string, unknown> = { ref: m.ref };
    if (m.name !== m.ref) entry.name = m.name;
    entry.header = m.header;
    if (hidden) entry.hidden = true;
    if (raw?.tab) entry.tab_color = `#${raw.tab.slice(2).toLowerCase()}`;
    if (raw?.freeze) entry.freeze = raw.freeze;
    entry.columns = cols;
    if (Object.keys(sheetDefs[si]!).length) entry.defs = sheetDefs[si];
    if (merges.length) entry.merges = merges;
    if (validations.length) entry.validate = validations;
    if (Object.keys(notes).length) entry.notes = notes;
    if (Object.keys(cellsFm).length) entry.cells = cellsFm;
    frontSheets.push(entry);

    // Trailing empty rows are not significant (P19).
    while (grid.length && grid[grid.length - 1]!.every((v) => v === "")) grid.pop();
    grids.push(grid);
    bodies.push(grid.map((row) => row.map((v) => (/[",\r\n]/.test(v) || v === "---" ? `"${v.replaceAll('"', '""')}"` : v)).join(",")).join("\n"));
  });

  const fm: Record<string, unknown> = { ycsv_version: 1 };
  if (Object.keys(bookDefs).length) fm.defs = bookDefs;
  fm.sheets = frontSheets;
  const yaml = YAML.stringify(fm, { lineWidth: 0 });
  const text = `---\n${yaml}---\n${bodies.join("\n---\n")}\n`;
  return { text, log, sheets, formulas, grids, names };
}

export function emitRefPublic(ref: string): string {
  return emitRef(ref);
}
export type { Issue };
