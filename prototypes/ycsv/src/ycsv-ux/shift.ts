import { scan, type Span } from "../ycsv-formula/tokenize";

/**
 * Shift an id-form formula by (dr, dc) positions, the way a copy or fill moves a
 * formula in Excel:
 * - `prijs@r_x` points at another row by row id. Shifting finds that row's index,
 *   adds dr and takes the row id there. `prijs@$r_x` keeps its row.
 * - A bare column name (`prijs`) means "this row", so it never needs a row shift.
 * - Column names shift by dc to the column dc places over (`$prijs` keeps its column).
 * Off the sheet edge becomes `#REF!`, like Excel.
 */
export type ShiftCtx = {
  colRefs: readonly string[];
  rowIds: readonly string[];
  rowIndex: ReadonlyMap<string, number>;
};

const BARE = /^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*$/;

function quote(ref: string): string {
  return BARE.test(ref) ? ref : `'${ref.replaceAll("'", "''")}'`;
}

function isCall(spans: Span[], i: number): boolean {
  for (let j = i + 1; j < spans.length; j += 1) {
    const span = spans[j];
    if (span?.t === "ws") continue;
    return span?.t === "op" && span.v === "(";
  }
  return false;
}

type Parsed = { colAbs: boolean; col: string; row: string | null; rowAbs: boolean };

function parseIdent(span: Extract<Span, { t: "ident" }>): Parsed | null {
  if (span.v === "#REF!" || span.v.includes(".")) return null;
  let v = span.v;
  let colAbs = false;
  if (!span.quoted && v.startsWith("$")) {
    colAbs = true;
    v = v.slice(1);
  }
  if (span.quoted && span.raw.startsWith("$")) colAbs = true;
  const at = v.lastIndexOf("@");
  if (at < 0) return { colAbs, col: v, row: null, rowAbs: false };
  let row = v.slice(at + 1);
  const rowAbs = row.startsWith("$");
  if (rowAbs) row = row.slice(1);
  return { colAbs, col: v.slice(0, at), row, rowAbs };
}

export function shiftFormula(src: string, dr: number, dc: number, ctx: ShiftCtx): string {
  if (!src.startsWith("=") || (dr === 0 && dc === 0)) return src;
  let spans: Span[];
  try {
    spans = scan(src.slice(1));
  } catch {
    return src;
  }
  let out = "=";
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (!span) continue;
    if (span.t !== "ident" || isCall(spans, i)) {
      out += span.raw;
      continue;
    }
    const parsed = parseIdent(span);
    const colIdx = parsed ? ctx.colRefs.indexOf(parsed.col) : -1;
    if (!parsed || colIdx < 0) {
      out += span.raw;
      continue;
    }
    let col = parsed.col;
    if (!parsed.colAbs && dc !== 0) {
      const next = ctx.colRefs[colIdx + dc];
      if (next === undefined) {
        out += "#REF!";
        continue;
      }
      col = next;
    }
    let row = parsed.row;
    if (row !== null && !parsed.rowAbs && dr !== 0) {
      const idx = ctx.rowIndex.get(row);
      const nextRow = idx === undefined ? undefined : ctx.rowIds[idx + dr];
      if (nextRow === undefined) {
        out += "#REF!";
        continue;
      }
      row = nextRow;
    }
    out += `${parsed.colAbs ? "$" : ""}${quote(col)}${row === null ? "" : `@${parsed.rowAbs ? "$" : ""}${row}`}`;
  }
  return out;
}

/** Replace every reference to a deleted column with #REF! (Excel does the same). */
export function dropColumnRefs(src: string, deletedRef: string): string {
  if (!src.startsWith("=")) return src;
  let spans: Span[];
  try {
    spans = scan(src.slice(1));
  } catch {
    return src;
  }
  let changed = false;
  let out = "=";
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (!span) continue;
    if (span.t === "ident" && !isCall(spans, i)) {
      const parsed = parseIdent(span);
      if (parsed && parsed.col === deletedRef) {
        out += "#REF!";
        changed = true;
        continue;
      }
    }
    out += span.raw;
  }
  return changed ? out : src;
}
