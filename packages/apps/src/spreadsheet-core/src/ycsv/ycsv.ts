// =============================================================================
// YCSV v1 — parser, serializer, formula resolver, and display formatter.
//
// A YCSV file is a YAML frontmatter block followed by one or more `---`-separated
// CSV bodies (one per sheet). See packages/apps/docs/ycsv-spec-v1.md.
// =============================================================================

import yaml from "js-yaml";
import { parseSheetCells, type SheetCells } from "@/spreadsheet-core/src/spreadsheet-cell-styles";

export type CellType =
  | "string"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "time"
  | "datetime"
  | "boolean";

export interface ColumnSetting {
  /** Lowercase identifier used in formulas (falls back to A-Z by position). */
  ref?: string;
  /** True when `ref` was set in column frontmatter (not A-Z position fallback). */
  refExplicit?: boolean;
  /** Display name (defaults to `ref`). */
  name?: string;
  type?: CellType;
  // Flat Intl options (currency/min/max fraction digits, dateStyle, timeStyle, …).
  currency?: string;
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  dateStyle?: "full" | "long" | "medium" | "short";
  timeStyle?: "full" | "long" | "medium" | "short";
  [extra: string]: unknown;
}

/** A scalar def inlines into formulas as a literal. */
export type DefScalar = string | number | boolean;
/** A mapping def exposes `name.key` label access and dropdown sources. */
export type DefMapping = Record<string, string>;
/** A list def is a dropdown source (not inlined into formulas). */
export type DefList = string[];
export type DefValue = DefScalar | DefMapping | DefList;
export type Defs = Record<string, DefValue>;

export interface ParsedSheet {
  /** Sheet identifier used in cross-sheet references (`sheet1`, `sheet2`, …). */
  ref: string;
  /** Display name (defaults to `ref`). */
  name: string;
  /** Resolved column settings (incl. A-Z fallback refs). */
  columnSettings: ColumnSetting[];
  /** Sheet-scoped defs merged over the workbook defs (sheet wins). */
  defs: Defs;
  /** Ordered ref names — index = column position. */
  refs: string[];
  /** Display headers (used as row 0 in the editor matrix). */
  headers: string[];
  /** CSV body data rows (header excluded). */
  rows: string[][];
  /** Whether the original CSV body contained a header row. */
  hadHeader: boolean;
  /** Cell-specific style overrides (§3.5). */
  cells?: SheetCells;
}

export interface ParsedWorkbook {
  version: number;
  /** Workbook-level (shared) defs. */
  defs: Defs;
  sheets: ParsedSheet[];
  /** Non-fatal issues encountered while parsing (e.g. higher spec version). */
  warnings: string[];
}

export const YCSV_VERSION = 1;

/** Minimum columns (A–E) for newly created sheets. */
export const DEFAULT_SHEET_COLUMN_COUNT = 5;
/** Minimum data rows (header excluded) for newly created sheets. */
export const DEFAULT_SHEET_ROW_COUNT = 5;

// =============================================================================
// File splitting — spec §A.2 (frontmatter + N CSV blocks)
// =============================================================================

const BLOCK_SEPARATOR = /\r?\n---\r?\n/;

export function splitYcsv(input: string): { fm: string; blocks: string[] } {
  const src = input.replace(/^\uFEFF/, "");
  if (!/^---\r?\n/.test(src)) {
    return { fm: "", blocks: [src] };
  }
  const rest = src.replace(/^---\r?\n/, "");
  const match = rest.match(BLOCK_SEPARATOR);
  if (!match || match.index === undefined) {
    return { fm: "", blocks: [src] };
  }
  const fm = rest.slice(0, match.index);
  const body = rest.slice(match.index + match[0].length);
  const blocks = body.split(BLOCK_SEPARATOR);
  return { fm, blocks };
}

// =============================================================================
// RFC 4180 CSV parser / serializer (minimal, sufficient for v1)
// =============================================================================

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop a trailing all-blank row only when the prior row has content (trailing newline artifact).
  if (
    rows.length > 1 &&
    rows[rows.length - 1].every((c) => c === "") &&
    !rows[rows.length - 2].every((c) => c === "")
  ) {
    rows.pop();
  }
  return rows;
}

export function serializeCSV(rows: string[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const v = c ?? "";
          if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
          return v;
        })
        .join(","),
    )
    .join("\n");
}

// =============================================================================
// Identifier helpers
// =============================================================================

const RESERVED = new Set(["true", "false", "null", "and", "or", "not"]);

export function isValidRefName(name: string): boolean {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return false;
  return !RESERVED.has(name);
}

export function colLetter(index: number): string {
  let s = "";
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function colIndexFromLetter(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function isScalarDef(v: unknown): v is DefScalar {
  const t = typeof v;
  return v !== null && (t === "string" || t === "number" || t === "boolean");
}

function isMappingDef(v: unknown): v is DefMapping {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Parse a `defs`/`constants` frontmatter mapping into validated {@link Defs}. */
function parseDefs(raw: unknown): Defs {
  const out: Defs = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidRefName(key)) continue;
    if (isScalarDef(value)) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) => String(item));
    } else if (isMappingDef(value)) {
      const mapping: DefMapping = {};
      for (const [k, v] of Object.entries(value)) mapping[k] = String(v);
      out[key] = mapping;
    }
  }
  return out;
}

function frontmatterDefs(frontmatter: Record<string, unknown>): Defs {
  // `defs` is the v1 field; `constants` is the deprecated v0 alias.
  if (frontmatter.defs !== undefined) return parseDefs(frontmatter.defs);
  return parseDefs(frontmatter.constants);
}

// =============================================================================
// Sheet column / header / row resolution — spec §4, §A.5
// =============================================================================

type SheetFrontmatter = {
  ref?: string;
  name?: string;
  columns?: unknown;
  defs?: unknown;
  constants?: unknown;
  cells?: unknown;
};

/** Build column settings for `count` columns (A-Z fallback when frontmatter omits `columns`). */
function buildColumnSettings(
  rawCols: Array<Record<string, unknown>>,
  colCount: number,
): ColumnSetting[] {
  const columnSettings: ColumnSetting[] = [];
  for (let i = 0; i < colCount; i++) {
    const raw = rawCols[i] ?? {};
    const explicitRef =
      typeof raw.ref === "string" && isValidRefName(raw.ref) ? raw.ref : undefined;
    const refValue = explicitRef ?? colLetter(i);
    const cs: ColumnSetting = {
      ref: refValue,
      refExplicit: explicitRef !== undefined,
      name: typeof raw.name === "string" ? raw.name : refValue,
    };
    if (typeof raw.type === "string") cs.type = raw.type as CellType;
    for (const [k, v] of Object.entries(raw)) {
      if (k === "ref" || k === "name" || k === "type" || v === undefined) continue;
      cs[k] = v;
    }
    columnSettings.push(cs);
  }
  return columnSettings;
}

function resolveSheet(
  index: number,
  sheetFm: SheetFrontmatter,
  csvText: string,
  workbookDefs: Defs,
): ParsedSheet {
  const ref =
    typeof sheetFm.ref === "string" && isValidRefName(sheetFm.ref)
      ? sheetFm.ref
      : `sheet${index + 1}`;
  const name = typeof sheetFm.name === "string" && sheetFm.name.trim() ? sheetFm.name : ref;

  const rawCols = Array.isArray(sheetFm.columns)
    ? (sheetFm.columns as Array<Record<string, unknown>>)
    : [];

  const localDefs =
    sheetFm.defs !== undefined ? parseDefs(sheetFm.defs) : parseDefs(sheetFm.constants);
  const defs: Defs = { ...workbookDefs, ...localDefs };

  const rawRows = parseCSV(csvText);
  const colCount = Math.max(rawCols.length, ...rawRows.map((r) => r.length), 1);

  const columnSettings = buildColumnSettings(rawCols, colCount);
  const refs = columnSettings.map((c) => c.ref!);

  // Detect an optional header row (spec §4.1).
  let hadHeader = false;
  let dataRows = rawRows;
  if (rawRows.length) {
    const first = rawRows[0].map((c) => c.trim());
    const knownRefs = new Set(refs.map((r) => r.toLowerCase()));
    // A formula cell is never part of a header row.
    const noFormulas = first.every((v) => !v.startsWith("="));
    const allMatchRefs =
      noFormulas &&
      first.length > 0 &&
      first.every((v) => v !== "" && knownRefs.has(v.toLowerCase()));
    const allNonNumeric =
      noFormulas && first.length > 0 && first.every((v) => v !== "" && !/^-?\d+(\.\d+)?$/.test(v));
    if (allMatchRefs || (rawCols.length === 0 && allNonNumeric)) {
      hadHeader = true;
      dataRows = rawRows.slice(1);
      // No `columns` defined + header present → use header values as refs.
      if (rawCols.length === 0) {
        for (let i = 0; i < first.length; i++) {
          const candidate = first[i].toLowerCase().replace(/[^a-z0-9_]/g, "_");
          if (isValidRefName(candidate)) {
            columnSettings[i] = { ...(columnSettings[i] ?? {}), ref: candidate, name: first[i] };
            refs[i] = candidate;
          }
        }
      }
    }
  }

  const rows = dataRows.map((r) => {
    const out = r.slice(0, colCount);
    while (out.length < colCount) out.push("");
    return out;
  });
  const headers = columnSettings.map((c) => c.name ?? c.ref!);
  const cells = parseSheetCells(sheetFm.cells);
  const cellsOut = Object.keys(cells).length ? cells : undefined;

  return { ref, name, columnSettings, defs, refs, headers, rows, hadHeader, cells: cellsOut };
}

// =============================================================================
// parseYcsv — spec §A
// =============================================================================

export function parseYcsv(input: string): ParsedWorkbook {
  const { fm, blocks } = splitYcsv(input);
  const warnings: string[] = [];

  let frontmatter: Record<string, unknown> = {};
  if (fm.trim()) {
    try {
      frontmatter = (yaml.load(fm) as Record<string, unknown>) ?? {};
    } catch {
      warnings.push("Frontmatter is not valid YAML; ignoring it.");
      frontmatter = {};
    }
  }

  let version = YCSV_VERSION;
  if (typeof frontmatter.ycsv_version === "number") {
    version = frontmatter.ycsv_version;
    if (version > YCSV_VERSION) {
      warnings.push(
        `File declares ycsv_version ${version}; this parser supports v${YCSV_VERSION}. Attempting best-effort parse.`,
      );
    }
  } else if (typeof frontmatter.markdown_sheets_version === "number") {
    version = frontmatter.markdown_sheets_version;
  } else {
    warnings.push("Missing ycsv_version; assuming v1.");
  }

  const workbookDefs = frontmatterDefs(frontmatter);

  const sheetDefs = Array.isArray(frontmatter.sheets)
    ? (frontmatter.sheets as SheetFrontmatter[])
    : null;

  const sheets: ParsedSheet[] = [];
  if (sheetDefs && sheetDefs.length) {
    // Honor every `sheets[]` entry (columns optional per spec §3.2).
    for (let i = 0; i < sheetDefs.length; i++) {
      sheets.push(resolveSheet(i, sheetDefs[i] ?? {}, blocks[i] ?? "", workbookDefs));
    }
  } else if (blocks.length > 1) {
    warnings.push(
      "Multiple CSV blocks without a sheets frontmatter array; inferring sheet1, sheet2, …",
    );
    for (let i = 0; i < blocks.length; i++) {
      const sheetFm: SheetFrontmatter =
        i === 0
          ? {
              columns: frontmatter.columns,
              name: typeof frontmatter.name === "string" ? frontmatter.name : undefined,
              ref: typeof frontmatter.ref === "string" ? frontmatter.ref : undefined,
              cells: frontmatter.cells,
            }
          : {};
      sheets.push(resolveSheet(i, sheetFm, blocks[i] ?? "", workbookDefs));
    }
  } else {
    const singleFm: SheetFrontmatter = {
      columns: frontmatter.columns,
      name: typeof frontmatter.name === "string" ? frontmatter.name : undefined,
      ref: typeof frontmatter.ref === "string" ? frontmatter.ref : undefined,
      cells: frontmatter.cells,
    };
    sheets.push(resolveSheet(0, singleFm, blocks[0] ?? "", workbookDefs));
  }

  return { version, defs: workbookDefs, sheets, warnings };
}

// =============================================================================
// serializeYcsv — emit frontmatter + CSV bodies (header row from refs)
// =============================================================================

const INTERNAL_COLUMN_KEYS = new Set(["ref", "name", "type", "refExplicit"]);

function serializeColumns(columnSettings: ColumnSetting[]): Record<string, unknown>[] {
  return columnSettings.map((c, index) => {
    const o: Record<string, unknown> = {};
    if (c.ref && c.ref !== colLetter(index)) o.ref = c.ref;
    else if (c.ref) o.ref = c.ref;
    if (c.name && c.name !== c.ref) o.name = c.name;
    if (c.type) o.type = c.type;
    for (const [k, v] of Object.entries(c)) {
      if (INTERNAL_COLUMN_KEYS.has(k)) continue;
      if (v !== undefined) o[k] = v;
    }
    return o;
  });
}

/** True when frontmatter should persist `columns` (named refs, types, or extra metadata). */
function hasExplicitColumnMetadata(columnSettings: ColumnSetting[]): boolean {
  return columnSettings.some((c, index) => {
    const fallbackRef = colLetter(index);
    if (c.type) return true;
    if (c.ref && c.ref !== fallbackRef) return true;
    if (c.name && c.name !== (c.ref ?? fallbackRef)) return true;
    return Object.keys(c).some((key) => !INTERNAL_COLUMN_KEYS.has(key));
  });
}

function sheetLocalDefsForSerialize(sheet: ParsedSheet, workbookDefs: Defs): Defs {
  const local: Defs = {};
  for (const [key, value] of Object.entries(sheet.defs)) {
    const workbookValue = workbookDefs[key];
    if (workbookValue === undefined || JSON.stringify(workbookValue) !== JSON.stringify(value)) {
      local[key] = value;
    }
  }
  return local;
}

function serializeSheetFrontmatterEntry(
  sheet: ParsedSheet,
  workbookDefs: Defs,
): Record<string, unknown> {
  const entry: Record<string, unknown> = { ref: sheet.ref };
  if (sheet.name && sheet.name !== sheet.ref) entry.name = sheet.name;
  const localDefs = sheetLocalDefsForSerialize(sheet, workbookDefs);
  if (Object.keys(localDefs).length) entry.defs = { ...localDefs };
  if (hasExplicitColumnMetadata(sheet.columnSettings)) {
    entry.columns = serializeColumns(sheet.columnSettings);
  }
  if (sheet.cells && Object.keys(sheet.cells).length) {
    const cellsOut: Record<string, { style: Record<string, unknown> }> = {};
    for (const [key, value] of Object.entries(sheet.cells)) {
      cellsOut[key] = { style: { ...value.style } };
    }
    entry.cells = cellsOut;
  }
  return entry;
}

export function serializeYcsv(workbook: ParsedWorkbook): string {
  const fm: Record<string, unknown> = { ycsv_version: workbook.version ?? YCSV_VERSION };
  if (workbook.defs && Object.keys(workbook.defs).length) {
    fm.defs = { ...workbook.defs };
  }

  const multiSheet = workbook.sheets.length > 1;
  if (multiSheet) {
    fm.sheets = workbook.sheets.map((sheet) =>
      serializeSheetFrontmatterEntry(sheet, workbook.defs),
    );
  } else {
    const sheet = workbook.sheets[0];
    if (sheet) {
      if (hasExplicitColumnMetadata(sheet.columnSettings)) {
        fm.columns = serializeColumns(sheet.columnSettings);
      }
      if (sheet.cells && Object.keys(sheet.cells).length) {
        const cellsOut: Record<string, { style: Record<string, unknown> }> = {};
        for (const [key, value] of Object.entries(sheet.cells)) {
          cellsOut[key] = { style: { ...value.style } };
        }
        fm.cells = cellsOut;
      }
    }
  }

  const dumped = yaml.dump(fm, { lineWidth: 100, noRefs: true }).trim();
  const bodies = workbook.sheets.map((sheet) => {
    const refs =
      sheet.refs.length > 0
        ? sheet.refs
        : sheet.columnSettings.map((c, i) => c.ref ?? colLetter(i));
    return serializeCSV([refs, ...sheet.rows]);
  });

  return `---\n${dumped}\n---\n${bodies.join("\n---\n")}\n`;
}

// =============================================================================
// Default sheet / workbook bootstrap (5 columns × 5 data rows)
// =============================================================================

function emptyDataRow(colCount: number): string[] {
  return Array.from({ length: colCount }, () => "");
}

/** Parsed sheet with columns A–E and five empty data rows (row 0 = headers in matrix). */
export function createDefaultSheet(ref = "sheet1"): ParsedSheet {
  const columnSettings: ColumnSetting[] = [];
  const refs: string[] = [];
  const headers: string[] = [];
  for (let i = 0; i < DEFAULT_SHEET_COLUMN_COUNT; i++) {
    const letter = colLetter(i);
    columnSettings.push({ ref: letter, name: letter, refExplicit: false });
    refs.push(letter);
    headers.push(letter);
  }
  const rows = Array.from({ length: DEFAULT_SHEET_ROW_COUNT }, () =>
    emptyDataRow(DEFAULT_SHEET_COLUMN_COUNT),
  );
  return {
    ref,
    name: ref,
    columnSettings,
    defs: {},
    refs,
    headers,
    rows,
    hadHeader: true,
  };
}

export function createDefaultWorkbook(): ParsedWorkbook {
  return {
    version: YCSV_VERSION,
    defs: {},
    sheets: [createDefaultSheet()],
    warnings: [],
  };
}

/** Minimal single-sheet `.ycsv` used for new workbooks and empty file loads. */
export const DEFAULT_EMPTY_YCSV = serializeYcsv(createDefaultWorkbook());

// =============================================================================
// Matrix conversions (row 0 = synthetic header row of names; data rows follow)
// =============================================================================

export function sheetToMatrix(sheet: Pick<ParsedSheet, "headers" | "rows">): { value: string }[][] {
  const head = sheet.headers.map((h) => ({ value: h }));
  const body = sheet.rows.map((r) => sheet.headers.map((_, i) => ({ value: r[i] ?? "" })));
  return [head, ...body];
}

export function matrixToSheet(
  matrix: { value?: string }[][],
  options?: { trimTrailingBlankRows?: boolean },
): {
  headers: string[];
  rows: string[][];
} {
  if (!matrix.length) return { headers: [], rows: [] };
  const headers = (matrix[0] ?? []).map((c) => c?.value ?? "");
  const rows = matrix.slice(1).map((r) => headers.map((_, i) => r[i]?.value ?? ""));
  if (options?.trimTrailingBlankRows !== false) {
    while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  }
  return { headers, rows };
}

// =============================================================================
// Formula resolution — spec §8
//
//   Named refs (`prijs2`) are rewritten to A1 refs (`A2`). Scalar defs inline as
//   literals; mapping defs expose `name.key` → label. Cross-sheet refs keep the
//   `sheet!` prefix with the column rewritten to its A1 letter.
// =============================================================================

function literal(v: DefScalar): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `"${String(v).replace(/"/g, '""')}"`;
}

function columnLetterForRef(sheet: ParsedSheet, ref: string): string | null {
  const idx = sheet.refs.findIndex((r) => r.toLowerCase() === ref.toLowerCase());
  return idx >= 0 ? colLetter(idx) : null;
}

/**
 * Rewrite a `=`-prefixed formula so its body uses only A1 cell references,
 * cross-sheet `sheet!A1` references, function names, and literals.
 */
export function resolveFormula(
  input: string,
  sheet: ParsedSheet,
  workbook: ParsedWorkbook,
): string {
  if (!input.startsWith("=")) return input;
  const sheetByRef = new Map(workbook.sheets.map((s) => [s.ref.toLowerCase(), s]));
  const body = input.slice(1);
  let out = "";
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"') {
      const end = body.indexOf('"', i + 1);
      const stop = end === -1 ? body.length : end + 1;
      out += body.slice(i, stop);
      i = stop;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < body.length && /[A-Za-z0-9_]/.test(body[j])) j++;
      const ident = body.slice(i, j);
      const isFnCall = body[j] === "(";

      // Cross-sheet prefix: sheetref!<columnref><row>
      if (body[j] === "!") {
        const target = sheetByRef.get(ident.toLowerCase());
        let k = j + 1;
        while (k < body.length && /[A-Za-z0-9_]/.test(body[k])) k++;
        const refToken = body.slice(j + 1, k);
        const refMatch = refToken.match(/^([A-Za-z][A-Za-z0-9_]*?)(\d+)$/);
        if (target && refMatch) {
          const letter = columnLetterForRef(target, refMatch[1]) ?? refMatch[1].toUpperCase();
          out += `${target.ref}!${letter}${refMatch[2]}`;
          i = k;
          continue;
        }
        out += `${ident}!${refToken}`;
        i = k;
        continue;
      }

      // `name.key` mapping-def access → label literal.
      if (!isFnCall && body[j] === ".") {
        let k = j + 1;
        while (k < body.length && /[A-Za-z0-9_]/.test(body[k])) k++;
        const key = body.slice(j + 1, k);
        const def = sheet.defs[ident];
        if (def && typeof def === "object" && !Array.isArray(def) && key in def) {
          out += literal((def as DefMapping)[key]);
          i = k;
          continue;
        }
      }

      // Named cell ref with trailing row number (prijs2, B2).
      const cellMatch = ident.match(/^([A-Za-z][A-Za-z0-9_]*?)(\d+)$/);
      if (!isFnCall && cellMatch) {
        const letter = columnLetterForRef(sheet, cellMatch[1]);
        if (letter) {
          out += `${letter}${cellMatch[2]}`;
          i = j;
          continue;
        }
        // Otherwise leave as-is (raw A1 like B2 passes through).
      }

      // Bare scalar def → inline literal.
      if (!isFnCall) {
        const def = sheet.defs[ident];
        if (isScalarDef(def)) {
          out += literal(def);
          i = j;
          continue;
        }
      }

      out += ident;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return "=" + out;
}

// =============================================================================
// Display formatting — spec §6, Intl-based
// =============================================================================

const INTL_NUMBER_KEYS = new Set([
  "currency",
  "currencyDisplay",
  "currencySign",
  "minimumIntegerDigits",
  "minimumFractionDigits",
  "maximumFractionDigits",
  "minimumSignificantDigits",
  "maximumSignificantDigits",
  "notation",
  "compactDisplay",
  "useGrouping",
  "signDisplay",
  "unit",
  "unitDisplay",
]);
const INTL_DATE_KEYS = new Set([
  "dateStyle",
  "timeStyle",
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
  "timeZone",
  "hour12",
  "hourCycle",
  "fractionalSecondDigits",
  "dayPeriod",
  "timeZoneName",
]);

function pick(col: ColumnSetting | undefined, keys: Set<string>): Record<string, unknown> {
  if (!col) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(col)) {
    if (keys.has(k) && v !== undefined) out[k] = v;
  }
  return out;
}

function parseAccountingNegative(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^\((.+)\)$/);
  return m ? "-" + m[1] : t;
}

/** Format a raw stored value for display, honoring the column's type + Intl options. */
export function formatValue(raw: string, col: ColumnSetting | undefined, locale?: string): string {
  if (raw === "" || raw == null) return "";
  const t = col?.type ?? "string";

  if (t === "string") return raw;

  if (t === "boolean") {
    if (raw === "true" || raw === "TRUE" || raw === "1") return "true";
    if (raw === "false" || raw === "FALSE" || raw === "0") return "false";
    return raw;
  }

  if (t === "number" || t === "currency" || t === "percent") {
    const n = Number(parseAccountingNegative(raw));
    if (!Number.isFinite(n)) return raw;
    const opts = pick(col, INTL_NUMBER_KEYS);
    if (t === "currency") {
      opts.style = "currency";
      if (!opts.currency) opts.currency = "USD";
    } else if (t === "percent") {
      opts.style = "percent";
    }
    try {
      const value = t === "percent" ? n / 100 : n;
      return new Intl.NumberFormat(col?.locale, opts as Intl.NumberFormatOptions).format(value);
    } catch {
      return String(n);
    }
  }

  if (t === "date" || t === "time" || t === "datetime") {
    const opts = pick(col, INTL_DATE_KEYS) as Intl.DateTimeFormatOptions;
    if (t === "date" && !opts.dateStyle && !opts.year) opts.dateStyle = "short";
    if (t === "time" && !opts.timeStyle && !opts.hour) opts.timeStyle = "short";
    if (t === "datetime") {
      if (!opts.dateStyle && !opts.year) opts.dateStyle = "short";
      if (!opts.timeStyle && !opts.hour) opts.timeStyle = "short";
    }
    let d: Date;
    if (t === "time") {
      const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      d = m ? new Date(1970, 0, 1, +m[1], +m[2], m[3] ? +m[3] : 0) : new Date(raw);
    } else {
      d = new Date(raw);
    }
    if (Number.isNaN(d.getTime())) return raw;
    try {
      return new Intl.DateTimeFormat(col?.locale ?? locale, opts).format(d);
    } catch {
      return d.toISOString();
    }
  }

  return raw;
}
