import { scan, type Span } from "../ycsv-formula/tokenize";

export type ColInfo = { colId: string; ref: string };

function isCall(spans: Span[], index: number): boolean {
  const next = spans[index + 1];
  return next?.t === "op" && next.v === "(";
}

function columnRef(ident: string, cols: ColInfo[], rowIds: string[]): string | null {
  const ranked = [...cols].sort((a, b) => b.ref.length - a.ref.length);
  for (const col of ranked) {
    if (!col.ref || !ident.startsWith(col.ref)) continue;
    const rest = ident.slice(col.ref.length);
    if (!/^\d+$/.test(rest)) continue;
    const n = Number(rest);
    if (n < 1 || n > rowIds.length) return "#REF!";
    return `${col.ref}@${rowIds[n - 1]}`;
  }
  return null;
}

function rewrite(src: string, mapIdent: (ident: string, call: boolean) => string): string {
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
    out += mapIdent(span.v, isCall(spans, i));
  }
  return out;
}

export function toIdForm(src: string, cols: ColInfo[], rowIds: string[]): string {
  return rewrite(src, (ident, call) => {
    if (call || ident.includes("@")) return ident;
    if (ident.includes(".")) return ident;
    return columnRef(ident, cols, rowIds) ?? ident;
  });
}

export function toFileForm(src: string, cols: ColInfo[], rowIds: string[]): string {
  void cols;
  return rewrite(src, (ident, call) => {
    if (call || !ident.includes("@")) return ident;
    const at = ident.indexOf("@");
    const ref = ident.slice(0, at);
    const rowId = ident.slice(at + 1);
    const idx = rowIds.indexOf(rowId);
    if (idx === -1) return "#REF!";
    return `${ref}${idx + 1}`;
  });
}
