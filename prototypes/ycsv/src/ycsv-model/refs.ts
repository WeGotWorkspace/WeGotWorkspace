import { scan, type Span } from "../ycsv-formula/tokenize";

export type ColInfo = { colId: string; ref: string; header?: string };

const BARE_REF = /^[A-Za-z_\u00C0-\u024F][A-Za-z0-9_\u00C0-\u024F]*$/;

function isCall(spans: Span[], index: number): boolean {
  const next = spans[index + 1];
  return next?.t === "op" && next.v === "(";
}

function columnLetterIndex(label: string): number | null {
  if (!/^[A-Z]+$/.test(label)) return null;
  let n = 0;
  for (const char of label) n = n * 26 + (char.charCodeAt(0) - 64);
  return n - 1;
}

function idRef(ref: string, rowId: string): string {
  return BARE_REF.test(ref) ? `${ref}@${rowId}` : `${quoteRef(ref)}@${rowId}`;
}

function rowRef(col: ColInfo, rowNumber: number, rowIds: string[]): string {
  if (!col.ref || rowNumber < 1 || rowNumber > rowIds.length) return "#REF!";
  const rowId = rowIds[rowNumber - 1];
  if (!rowId) return "#REF!";
  return idRef(col.ref, rowId);
}

function matchLabel(ident: string, cols: ColInfo[], rowIds: string[], labelOf: (col: ColInfo) => string): string | null {
  const ranked = cols
    .map((col, index) => ({ col, index, label: labelOf(col) }))
    .sort((a, b) => b.label.length - a.label.length);
  for (const item of ranked) {
    if (!item.label || !ident.startsWith(item.label)) continue;
    const rest = ident.slice(item.label.length);
    if (!/^\d+$/.test(rest)) continue;
    return rowRef(item.col, Number(rest), rowIds);
  }
  return null;
}

function positionalRef(ident: string, cols: ColInfo[], rowIds: string[]): string | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ident);
  if (!match) return null;
  const index = columnLetterIndex(match[1] ?? "");
  const rowNumber = Number(match[2]);
  if (index === null || index >= cols.length) return "#REF!";
  const col = cols[index];
  if (!col) return "#REF!";
  return rowRef(col, rowNumber, rowIds);
}

function quoteRef(ref: string): string {
  return `'${ref.replaceAll("'", "''")}'`;
}

export function refsThatMustBeQuoted(refs: string[]): Set<string> {
  const present = refs.filter((ref) => ref !== "");
  const quoted = new Set<string>();
  for (const ref of present) {
    if (!BARE_REF.test(ref)) {
      quoted.add(ref);
      continue;
    }
    for (const other of present) {
      if (other.length <= ref.length || !other.startsWith(ref)) continue;
      if (/^\d+$/.test(other.slice(ref.length))) quoted.add(ref);
    }
  }
  return quoted;
}

function rewrite(src: string, mapIdent: (span: Extract<Span, { t: "ident" }>, call: boolean) => string): string {
  if (!src.startsWith("=")) return src;
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
    if (span.t !== "ident") {
      out += span.raw;
      continue;
    }
    out += mapIdent(span, isCall(spans, i));
  }
  return out;
}

export function toIdForm(
  src: string,
  cols: ColInfo[],
  rowIds: string[],
  rowIndex?: ReadonlyMap<string, number>,
): string {
  void rowIndex;
  return rewrite(src, (span, call) => {
    if (call) return span.raw;
    if (span.quoted) {
      const suffix = span.suffix ?? "";
      if (!/^\d+$/.test(suffix)) return span.raw;
      const rowNumber = Number(suffix);
      if (rowNumber < 1 || rowNumber > rowIds.length) return "#REF!";
      return `${quoteRef(span.v)}@${rowIds[rowNumber - 1]}`;
    }
    if (span.v.includes(".") || span.v.includes("@") || !/\d/.test(span.v)) return span.raw;
    const byRef = matchLabel(span.v, cols, rowIds, (col) => col.ref);
    if (byRef) return byRef;
    const byHeader = matchLabel(span.v, cols, rowIds, (col) => (col.header && col.header !== col.ref ? col.header : ""));
    if (byHeader) return byHeader;
    return positionalRef(span.v, cols, rowIds) ?? span.raw;
  });
}

export function toFileForm(
  src: string,
  cols: ColInfo[],
  rowIds: string[],
  rowIndex?: ReadonlyMap<string, number>,
  mustQuote?: ReadonlySet<string>,
): string {
  const quoted = mustQuote ?? refsThatMustBeQuoted(cols.map((col) => col.ref));
  return rewrite(src, (span, call) => {
    if (call) return span.raw;
    const at = span.v.lastIndexOf("@");
    if (at < 0) return span.raw;
    const ref = span.v.slice(0, at);
    const rowId = span.v.slice(at + 1);
    const idx = rowIndex ? rowIndex.get(rowId) : rowIds.indexOf(rowId);
    if (idx === undefined || idx < 0) return "#REF!";
    const emitted = quoted.has(ref) ? quoteRef(ref) : ref;
    return `${emitted}${idx + 1}`;
  });
}
