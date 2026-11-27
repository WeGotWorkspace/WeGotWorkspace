// Formula translation between Excel A1 syntax and YCSV column-ref syntax (spike 11).
//
// Row numbers follow the spec (§7.1, Wouter's decision on P1): the first data row is row 1,
// a header row is row 0, and (§7.2, P30 accepted) fully empty rows keep their number. A1 row
// numbers are mapped per sheet (`SheetCols.rows`): with a header in source row 1, Excel row
// 2 = YCSV row 1, and every row is one less; without a header, A1 row = YCSV row.
// Also assumes these spike 11 proposals in upstream/ycsv-spec-v1.md:
//   P4  `$` absolute markers, rectangular ranges, whole-column ranges `x:x`, `sheet!a1:b2`
//   P12 refs that are not plain identifiers, or that end in a digit, are quoted: 'Q1'2
// Excel → YCSV swaps column letters for column refs, sheet names for sheet refs, and
// subtracts the header offset from row numbers.

/**
 * `rows[i]`: YCSV row number of source row i (0-based): 0 for the header, null for a fully
 * empty row (§7.2), else 1, 2, 3 … Missing → identity (A1 row = YCSV row).
 */
export type SheetCols = { name: string; ref: string; refs: string[]; rows?: (number | null)[] };

/**
 * YCSV row numbers for a grid (spec §7.1, §7.2 with P30 accepted): the header is row 0 and
 * every other row, empty or not, is numbered. Before P30 empty rows got null (no number); the
 * null paths below stay for rows maps built by hand.
 */
export function rowNumbers(grid: string[][], header: boolean): (number | null)[] {
  return grid.map((_, i) => (header ? i : i + 1));
}

/**
 * Source (A1, 1-based) row → YCSV row. On an empty row: `side` "start" takes the next
 * numbered row, "end" the previous one, "single" returns null. Past the grid: continues.
 */
export function toYRow(rows: (number | null)[] | undefined, a1: number, side: "start" | "end" | "single" = "single"): number | null {
  if (!rows) return a1;
  const i = a1 - 1;
  if (i >= rows.length) {
    let last = rows.length - 1;
    while (last >= 0 && rows[last] === null) last--;
    return (last >= 0 ? rows[last]! : 0) + (i - last);
  }
  if (rows[i] !== null) return rows[i]!;
  if (side === "single") return null;
  if (side === "start") {
    for (let j = i + 1; j < rows.length; j++) if (rows[j] !== null) return rows[j]!;
    return toYRow(rows, rows.length + 1);
  }
  for (let j = i - 1; j >= 0; j--) if (rows[j] !== null) return rows[j]!;
  return 0;
}

/** YCSV row → source (A1, 1-based) row. */
export function toA1Row(rows: (number | null)[] | undefined, y: number): number {
  if (!rows) return y;
  const i = rows.indexOf(y);
  if (i >= 0) return i + 1;
  let last = rows.length - 1;
  while (last >= 0 && rows[last] === null) last--;
  const lastY = last >= 0 ? rows[last]! : 0;
  return last + 1 + (y - lastY);
}

/** Map every row number in an A1 address or range with `fn` (null drops the address). */
export function mapAddress(addr: string, fn: (row: number, side: "start" | "end" | "single") => number | null): string | null {
  const parts = addr.split(":");
  const out: string[] = [];
  for (const [k, part] of parts.entries()) {
    const m = /^(\$?[A-Z]{1,3}\$?)(\d+)$/.exec(part);
    if (!m) return addr;
    const side = parts.length === 1 ? "single" : k === 0 ? "start" : "end";
    const row = fn(Number(m[2]), side);
    if (row === null) return null;
    out.push(`${m[1]}${row}`);
  }
  return out.join(":");
}



const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** Bare when it is an identifier that does not end in a digit, else single-quoted. */
export function emitRef(ref: string): string {
  if (IDENT.test(ref) && !/\p{N}$/u.test(ref)) return ref;
  return `'${ref.replaceAll("'", "''")}'`;
}

export function colLetters(index: number): string {
  let s = "";
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export type Issue = { kind: "lost" | "degraded"; what: string };

// --- ODS OpenFormula → Excel A1 (SheetJS CE leaves ODS formulas in OpenFormula form) --------
export function openFormulaToA1(f: string): string {
  return f
    .replace(/\[\$?'?([^\].']+(?:''[^\].']*)*)'?\.(\$?[A-Z]+\$?\d*):\.(\$?[A-Z]+\$?\d*)\]/g, (_, sh: string, a: string, b: string) => `${qSheet(sh)}!${a}:${b}`)
    .replace(/\[\$?'?([^\].']+(?:''[^\].']*)*)'?\.(\$?[A-Z]+\$?\d+)\]/g, (_, sh: string, a: string) => `${qSheet(sh)}!${a}`)
    .replace(/\[\.(\$?[A-Z]+\$?\d*):\.(\$?[A-Z]+\$?\d*)\]/g, "$1:$2")
    .replace(/\[\.(\$?[A-Z]+\$?\d+)\]/g, "$1");
}

function qSheet(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `'${name.replaceAll("'", "''")}'`;
}

// --- Excel A1 → YCSV ------------------------------------------------------------------------

const A1_TOKEN =
  /("(?:[^"]|"")*")|(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_.]*))!|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\p{L}\p{N}_(])|(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})(?![\p{L}\p{N}_(])|(\d+):(\d+)(?![\p{L}\p{N}_])|([\p{L}_][\p{L}\p{N}_.]*)(?=\s*\()|([\p{L}_][\p{L}\p{N}_.]*)|(\[)|(\{)/gu;

export type A1Context = {
  sheets: SheetCols[];
  /** Index of the sheet that owns the formula. */
  self: number;
  /** Excel defined-name (lower-cased) → YCSV def key. */
  names: Map<string, string>;
};

/**
 * Translate an Excel formula body (no leading `=`; `_xlfn.` already stripped by SheetJS) to
 * a YCSV formula body. Returns issues for features that do not survive.
 */
export function a1ToYcsv(formula: string, ctx: A1Context): { text: string; issues: Issue[] } {
  const issues: Issue[] = [];
  let pendingSheet: number | null = null;
  let out = "";
  let last = 0;
  let inRangeEnd = false;
  let lastTarget: number | null = null;
  for (const m of formula.matchAll(A1_TOKEN)) {
    out += formula.slice(last, m.index);
    last = m.index! + m[0].length;
    const [tok, str, qsheet, sheet, ac, col, ar, row, cc1, c1, cc2, c2, r1, r2, fn, ident, bracket, brace] = m;
    if (str) {
      out += str;
      continue;
    }
    if (qsheet !== undefined || sheet !== undefined) {
      const name = qsheet !== undefined ? qsheet.replaceAll("''", "'") : sheet!;
      const idx = ctx.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());
      if (idx < 0) {
        issues.push({ kind: "lost", what: `reference to unknown sheet ${name}` });
        out += "#REF!";
        pendingSheet = -1;
        continue;
      }
      pendingSheet = idx;
      out += `${emitRef(ctx.sheets[idx]!.ref)}!`;
      continue;
    }
    const target = pendingSheet !== null && pendingSheet >= 0 ? pendingSheet : inRangeEnd ? (lastTarget ?? ctx.self) : ctx.self;
    if (col !== undefined) {
      const refs = ctx.sheets[target]!.refs;
      const ci = colIndex(col);
      const ref = refs[ci] ?? colLetters(ci);
      const side = formula[last] === ":" ? "start" : formula[m.index! - 1] === ":" ? "end" : "single";
      const y = toYRow(ctx.sheets[target]!.rows, Number(row), side);
      if (y === null) {
        issues.push({ kind: "lost", what: `reference to row ${row}, which has no YCSV number` });
        out += "#REF!";
      } else out += `${ac}${emitRef(ref)}${ar}${y}`;
      lastTarget = target;
      pendingSheet = null;
      inRangeEnd = formula[last] === ":";
      continue;
    }
    if (c1 !== undefined) {
      const refs = ctx.sheets[target]!.refs;
      out += `${cc1}${emitRef(refs[colIndex(c1)] ?? c1)}:${cc2}${emitRef(refs[colIndex(c2!)] ?? c2!)}`;
      pendingSheet = null;
      continue;
    }
    if (r1 !== undefined) {
      issues.push({ kind: "lost", what: `row range ${r1}:${r2}` });
      out += tok;
      pendingSheet = null;
      continue;
    }
    if (fn !== undefined) {
      if (fn === "__xludf.DUMMYFUNCTION") issues.push({ kind: "degraded", what: "Google-only function (cached value kept)" });
      out += fn.replace(/^_xlfn\.(_xlws\.)?/, "").toUpperCase();
      inRangeEnd = false;
      continue;
    }
    if (ident !== undefined) {
      const upper = ident.toUpperCase();
      const def = ctx.names.get(ident.toLowerCase());
      if (def) out += def;
      else if (upper === "TRUE" || upper === "FALSE") out += upper;
      else {
        issues.push({ kind: "lost", what: `unknown name ${ident}` });
        out += ident;
      }
      inRangeEnd = false;
      continue;
    }
    if (bracket) issues.push({ kind: "lost", what: "structured table reference" });
    if (brace) issues.push({ kind: "degraded", what: "array constant" });
    out += tok;
  }
  out += formula.slice(last);
  if (/(\d|\))\s*%/.test(stripStrings(out))) issues.push({ kind: "degraded", what: "postfix % (spec §8.6 reads % as modulo)" });
  return { text: out, issues };
}
function stripStrings(s: string): string {
  return s.replace(/"(?:[^"]|"")*"/g, '""');
}

// --- YCSV → Excel A1 ------------------------------------------------------------------------

const Y_TOKEN =
  /("(?:[^"]|"")*")|(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_]*))!|(\$?)(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_]*?))(\$?)(\d+)(?![\p{L}\p{N}_(])|([\p{L}_][\p{L}\p{N}_.]*)(?=\s*\()|(\$?)([\p{L}_][\p{L}\p{N}_.]*)/gu;

export type YContext = {
  sheets: SheetCols[];
  self: number;
  /** YCSV def key → Excel defined name. */
  names: Map<string, string>;
  /** Excel sheet-name quoting for output. */
  sheetName?: (index: number) => string;
};

/** Translate a YCSV formula body back to Excel A1. */
export function ycsvToA1(formula: string, ctx: YContext): { text: string; issues: Issue[] } {
  const issues: Issue[] = [];
  let pending: number | null = null;
  let last = 0;
  let out = "";
  let rangeTarget: number | null = null;
  const findCol = (sheet: number, ref: string) => ctx.sheets[sheet]!.refs.findIndex((r) => r === ref || r.toLowerCase() === ref.toLowerCase());
  for (const m of formula.matchAll(Y_TOKEN)) {
    out += formula.slice(last, m.index);
    last = m.index! + m[0].length;
    const [tok, str, qsheet, sheet, ac, qref, ref, ar, row, fn, cc, ident] = m;
    if (str) {
      out += str;
      continue;
    }
    if (qsheet !== undefined || sheet !== undefined) {
      const key = qsheet !== undefined ? qsheet.replaceAll("''", "'") : sheet!;
      const idx = ctx.sheets.findIndex((s) => s.ref === key || s.ref.toLowerCase() === key.toLowerCase());
      if (idx < 0) {
        issues.push({ kind: "lost", what: `unknown sheet ref ${key}` });
        out += "#REF!";
        pending = -1;
        continue;
      }
      pending = idx;
      out += `${ctx.sheetName ? ctx.sheetName(idx) : qSheet(ctx.sheets[idx]!.name)}!`;
      continue;
    }
    const target = pending !== null && pending >= 0 ? pending : formula[m.index! - 1] === ":" && rangeTarget !== null ? rangeTarget : ctx.self;
    if (row !== undefined) {
      const name = qref !== undefined ? qref.replaceAll("''", "'") : ref!;
      const ci = findCol(target, name);
      const letters = ci >= 0 ? colLetters(ci) : /^[A-Z]{1,3}$/.test(name) ? name : null;
      if (letters === null) {
        issues.push({ kind: "lost", what: `unknown column ref ${name}` });
        out += "#REF!";
      } else out += `${ac}${letters}${ar}${toA1Row(ctx.sheets[target]!.rows, Number(row))}`;
      rangeTarget = target;
      pending = null;
      continue;
    }
    if (fn !== undefined) {
      out += fn;
      continue;
    }
    if (ident !== undefined) {
      // Whole-column range `totaal:totaal` (either side of the colon).
      const nearColon = formula[m.index! - 1] === ":" || formula[last] === ":";
      if (nearColon && findCol(target, ident) >= 0) {
        out += `${cc}${colLetters(findCol(target, ident))}`;
        rangeTarget = target;
        pending = null;
        continue;
      }
      out += cc;
      const def = ctx.names.get(ident);
      if (def) out += def;
      else if (/^(TRUE|FALSE)$/i.test(ident)) out += ident.toUpperCase();
      else if (findCol(ctx.self, ident) >= 0) {
        issues.push({ kind: "degraded", what: "same-row ref" });
        out += colLetters(findCol(ctx.self, ident));
      } else out += ident;
      continue;
    }
    out += tok;
  }
  out += formula.slice(last);
  return { text: out, issues };
}
