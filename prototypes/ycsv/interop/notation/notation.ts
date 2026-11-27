// Spike 11: formula notation per locale. The file always stores the canonical form
// (`=ROUND(3.27,1)`: `.` decimal, `,` argument separator). The editor may show and accept the
// locale form (`=ROUND(3,27;1)` in nl-NL). This module converts between the two.
//
// Rules (same as Excel and LibreOffice): when the locale's decimal separator is `,`, the
// argument separator becomes `;`. Strings ("…") and quoted refs ('…') are never touched.

export type Notation = { decimal: "." | ","; separator: "," | ";" };

export const CANONICAL: Notation = { decimal: ".", separator: "," };

/** Locale notation from Intl: decimal separator of the locale, `;` when that is `,`. */
export function notationFor(locale: string): Notation {
  const dec = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")?.value;
  return dec === "," ? { decimal: ",", separator: ";" } : CANONICAL;
}

type Tok = { kind: "str" | "qref" | "num" | "word" | "sep" | "other"; text: string };

/** Split a formula body into tokens; `num` is a number literal in the given notation. */
function tokenize(src: string, n: Notation): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const numRe = n.decimal === "." ? /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?%?/ : /^(\d+(,\d*)?|,\d+)([eE][+-]?\d+)?%?/;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === ch && src[j + 1] === ch) j += 2;
        else if (src[j] === ch) break;
        else j += 1;
      }
      out.push({ kind: ch === '"' ? "str" : "qref", text: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    const word = /^[\p{L}_][\p{L}\p{N}_.]*/u.exec(src.slice(i));
    if (word) {
      out.push({ kind: "word", text: word[0] });
      i += word[0].length;
      continue;
    }
    // A number only when not glued to a preceding word or quoted ref (e.g. `'Zo Doen'2`, `prijs2`).
    const prev = out[out.length - 1];
    const glued = prev && (prev.kind === "qref" || prev.kind === "word") && !/\s$/.test(prev.text);
    const num = numRe.exec(src.slice(i));
    if (num && !(glued && /^\d/.test(num[0]))) {
      // In `,`-decimal notation `1,` followed by nothing numeric is not a decimal.
      const text = n.decimal === "," && /,$/.test(num[1]!) && !num[3] ? num[0].replace(/,$/, "") : num[0];
      out.push({ kind: "num", text });
      i += text.length;
      continue;
    }
    if (num) {
      // digits glued to a ref: row number, keep as part of the ref
      const digits = /^\d+/.exec(src.slice(i))![0];
      out.push({ kind: "other", text: digits });
      i += digits.length;
      continue;
    }
    if (ch === n.separator) {
      out.push({ kind: "sep", text: ch });
      i += 1;
      continue;
    }
    out.push({ kind: "other", text: ch });
    i += 1;
  }
  return out;
}

/** Convert a formula (with or without leading `=`) from one notation to another. */
export function convert(formula: string, from: Notation, to: Notation): string {
  if (from.decimal === to.decimal && from.separator === to.separator) return formula;
  const lead = formula.startsWith("=") ? "=" : "";
  const body = lead ? formula.slice(1) : formula;
  return lead + tokenize(body, from).map((t) => {
    if (t.kind === "num") return t.text.replace(from.decimal, to.decimal);
    if (t.kind === "sep") return to.separator;
    return t.text;
  }).join("");
}

export const toLocale = (canonical: string, locale: string) => convert(canonical, CANONICAL, notationFor(locale));
export const fromLocale = (typed: string, locale: string) => convert(typed, notationFor(locale), CANONICAL);

/**
 * What the editor should do with typed input in a `,`-decimal locale when the user may type
 * either notation. Returns the canonical text plus a warning when the input is ambiguous
 * (a `,` that can be a decimal or a separator and no `;` anywhere).
 */
export function readInput(typed: string, locale: string): { canonical: string; ambiguous: boolean } {
  const n = notationFor(locale);
  if (n.decimal === ".") return { canonical: typed, ambiguous: false };
  const toks = tokenize(typed.replace(/^=/, ""), n);
  const hasSemicolon = toks.some((t) => t.kind === "sep");
  const decimalComma = toks.some((t) => t.kind === "num" && t.text.includes(","));
  return { canonical: fromLocale(typed, locale), ambiguous: decimalComma && !hasSemicolon };
}
