// Spike 11: column refs from the header text alone (proposal P33, spec §4.4).
//
// A file without frontmatter (or without `columns`) has nowhere to store a generated ref, so
// the ref must follow from the header text by a fixed rule. The rule keeps the text as it is
// (no slug) and relies on the quoted-ref syntax of P12/P28 for anything that is not a plain
// identifier:
//
// H1 ref = header text, Unicode NFC, trimmed, every run of whitespace replaced by one space.
// H2 In formulas the ref is bare when it is an identifier that does not end in a digit, else
//    quoted: `'Prijs incl. BTW'3`, `'kw1'2`, `'Jan''s'2` (emitRef in xlsx/translate.ts).
// H3 Refs compare case-insensitively (Unicode lower case), like names in Excel and
//    LibreOffice. A formula may write `prijs2` for header "Prijs"; writers keep the header's
//    own spelling.
// H4 An empty header cell gives no ref.
// H5 Header texts that are equal under H1+H3 give no ref, all of them (not "the first wins"):
//    a suffix by position would silently retarget formulas when a column moves.
// H6 Columns without a ref (H4, H5) get their A-Z letter (§4.2), unless that letter is already
//    the ref of another column (header refs win), then they get none.
// Each case that loses a ref is a warning, never silent.

import { colLetters, emitRef } from "../xlsx/translate";

export type HeaderRef = { index: number; ref: string | null; display: string; source: "header" | "letter" | "none" };

export const refText = (s: string) => s.normalize("NFC").trim().replace(/\s+/gu, " ");
export const refKey = (s: string) => refText(s).toLowerCase();

export function headerRefs(header: string[]): { columns: HeaderRef[]; warnings: string[] } {
  const warnings: string[] = [];
  const counts = new Map<string, number>();
  for (const h of header) {
    const k = refKey(h);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const columns: HeaderRef[] = header.map((h, index) => {
    const text = refText(h);
    if (!text) return { index, ref: null, display: "", source: "none" };
    if (counts.get(refKey(h))! > 1) return { index, ref: null, display: text, source: "none" };
    return { index, ref: text, display: text, source: "header" };
  });
  const taken = new Set(columns.filter((c) => c.ref).map((c) => refKey(c.ref!)));
  for (const c of columns) {
    if (c.ref) continue;
    const letter = colLetters(c.index);
    const why = c.display ? `header "${c.display}" occurs more than once` : "header cell is empty";
    if (taken.has(letter.toLowerCase())) {
      warnings.push(`column ${c.index + 1}: ${why}, and its letter ${letter} is the header of another column; it has no ref`);
    } else {
      c.ref = letter;
      c.source = "letter";
      if (!c.display) c.display = letter;
      warnings.push(`column ${c.index + 1}: ${why}; formulas use its letter ${letter}`);
    }
  }
  return { columns, warnings };
}

/** The formula text for `ref` at YCSV row `row`. */
export const cellRef = (ref: string, row: number) => `${emitRef(ref)}${row}`;
