import { scan, type Span } from "../../ycsv-formula/tokenize";
import { refsThatMustBeQuoted, toFileForm, toIdForm, type ColInfo } from "../../ycsv-model/refs";

/**
 * File form ↔ id form for a workbook (integration slice). Same-sheet refs go through the
 * single-sheet converters of the prototype (`ycsv-model/refs.ts`); a sheet prefix is added:
 *
 *   file form  `categorieën!label1`, `'Mijn blad'!prijs3`, `SUM(p!totaal1:p!totaal10)`
 *   id form    `s_ab12cd34!label@r_x`                       (sheet by id, row by id)
 *
 * Sheets are named by id in the doc so renaming a sheet (its `ref`) never breaks a formula,
 * the same reason rows are named by id. Columns keep their ref, as in every spike.
 */
export type RefSheet = {
  sheetId: string;
  ref: string;
  cols: ColInfo[];
  rowIds: string[];
  rowIndex?: ReadonlyMap<string, number>;
  /** Column refs that need quoting; computed once per sheet (it was once per formula). */
  mustQuote?: Set<string>;
};
export type RefScope = {
  self: RefSheet;
  byRef: (ref: string) => RefSheet | null;
  byId: (id: string) => RefSheet | null;
};

const BARE_SHEET = /^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*$/;
export const quoteSheet = (ref: string): string => (BARE_SHEET.test(ref) ? ref : `'${ref.replaceAll("'", "''")}'`);

type Ident = Extract<Span, { t: "ident" }>;

function isCall(spans: Span[], i: number): boolean {
  for (let j = i + 1; j < spans.length; j += 1) {
    const span = spans[j];
    if (span?.t === "ws") continue;
    return span?.t === "op" && span.v === "(";
  }
  return false;
}

/** The sheet part of an ident (`p!x` → p), or null. */
function sheetPart(span: Ident): { sheet: string; rest: string } | null {
  const bang = span.v.indexOf("!");
  if (bang < 0) return null;
  const rest = span.quotedSheet ? span.raw.slice(span.raw.lastIndexOf("!") + 1) : span.v.slice(bang + 1);
  return { sheet: span.v.slice(0, bang), rest };
}

/** The sheet of the range start right before this ident (`p!a1:` + `a9`), if any. */
function rangeSheet(spans: Span[], i: number): string | null {
  let j = i - 1;
  while (j >= 0 && spans[j]?.t === "ws") j -= 1;
  const colon = spans[j];
  if (colon?.t !== "op" || colon.v !== ":") return null;
  j -= 1;
  while (j >= 0 && spans[j]?.t === "ws") j -= 1;
  const left = spans[j];
  return left?.t === "ident" ? (sheetPart(left)?.sheet ?? null) : null;
}

function rewrite(src: string, map: (span: Ident, i: number, spans: Span[]) => string): string {
  if (!src.startsWith("=")) return src;
  let spans: Span[];
  try {
    spans = scan(src.slice(1));
  } catch {
    return src;
  }
  let out = "=";
  spans.forEach((span, i) => {
    out += span.t === "ident" && !isCall(spans, i) ? map(span, i, spans) : span.raw;
  });
  return out;
}

const one = (fn: (formula: string) => string, ident: string): string => fn(`=${ident}`).slice(1);

export function bookToIdForm(src: string, scope: RefScope): string {
  if (!src.startsWith("=")) return src;
  // Fast path: no sheet prefix anywhere → the single-sheet converter, one scan.
  if (!src.includes("!")) return toIdForm(src, scope.self.cols, scope.self.rowIds);
  return rewrite(src, (span, i, spans) => {
    const part = sheetPart(span);
    const inherited = part ? null : rangeSheet(spans, i);
    if (!part && !inherited) return one((f) => toIdForm(f, scope.self.cols, scope.self.rowIds), span.raw);
    const sheet = part ? scope.byRef(part.sheet) : scope.byRef(inherited as string);
    if (!sheet) return "#REF!";
    const converted = one((f) => toIdForm(f, sheet.cols, sheet.rowIds), part ? part.rest : span.raw);
    if (converted === "#REF!") return converted;
    return `${sheet.sheetId}!${converted}`;
  });
}

export function bookToFileForm(src: string, scope: RefScope): string {
  if (!src.startsWith("=")) return src;
  const mustQuote = (sheet: RefSheet) => (sheet.mustQuote ??= refsThatMustBeQuoted(sheet.cols.map((col) => col.ref)));
  // Fast path (integration measurement: serialize was 6× spike 4 at 10k × 30): no sheet
  // prefix and no `#REF!` → the single-sheet converter, one scan per formula.
  if (!src.includes("!")) return toFileForm(src, scope.self.cols, scope.self.rowIds, scope.self.rowIndex, mustQuote(scope.self));
  return rewrite(src, (span) => {
    const part = sheetPart(span);
    if (!part) return one((f) => toFileForm(f, scope.self.cols, scope.self.rowIds, scope.self.rowIndex, mustQuote(scope.self)), span.raw);
    const sheet = scope.byId(part.sheet);
    if (!sheet) return "#REF!";
    const converted = one((f) => toFileForm(f, sheet.cols, sheet.rowIds, sheet.rowIndex, mustQuote(sheet)), part.rest);
    if (converted === "#REF!") return converted;
    return `${quoteSheet(sheet.ref)}!${converted}`;
  });
}
