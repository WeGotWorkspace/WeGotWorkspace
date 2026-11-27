// Spike 11: how `columns` (optional enrichment) attaches to the CSV columns when the sheet
// has a header row. Proposal C1–C5 in spec §4 (marked "Proposal (spike 11)").
//
// C1 With a header row, the header text is the display name. `columns[i].name` is ignored
//    (a warning when it differs); writers do not write `name` when header is true.
// C2 A definition whose `ref` equals a header text (P33 H1+H3: NFC, trimmed, whitespace folded,
//    case-insensitive; a slug match also counts, for refs that importers slugged) attaches to
//    that column, wherever it is. This keeps hand-typed and tool-reordered CSVs correct.
// C3 Definitions that matched nothing attach to the remaining columns by position.
// C4 More CSV columns than definitions: the extra columns are untyped, ref = header text, P33 H1 (or
//    A-Z without a header). More definitions than CSV columns: the extras are unused (warning);
//    formulas that use their refs give #REF!.
// C5 Without a header row: position only, and `name` is the display name.

import { refKey, refText } from "./header-refs";

export type ColumnDef = { ref?: string; name?: string; type?: string; [k: string]: unknown };
export type Resolved = { index: number; ref: string; display: string; def?: ColumnDef; how: "name" | "position" | "none" };

export const slug = (s: string) => s.normalize("NFC").toLowerCase().trim().replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "");

function letters(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function resolveColumns(headerRow: string[] | null, width: number, defs: ColumnDef[] = []): { columns: Resolved[]; warnings: string[] } {
  const warnings: string[] = [];
  const out: (Resolved | undefined)[] = Array.from({ length: width }, () => undefined);
  const used = new Set<number>();
  if (headerRow) {
    // C2: by ref = header text.
    defs.forEach((d, di) => {
      if (!d.ref) return;
      const same = (h: string) => refKey(h) === refKey(d.ref!) || slug(h) === slug(d.ref!);
      const c = headerRow.findIndex((h, i) => !out[i] && same(h));
      if (c >= 0) {
        out[c] = { index: c, ref: d.ref, display: headerRow[c]!.trim(), def: d, how: "name" };
        used.add(di);
      }
    });
  }
  // C3 / C5: the rest by position, in order.
  const free = defs.map((d, di) => ({ d, di })).filter(({ di }) => !used.has(di));
  let next = 0;
  for (let c = 0; c < width; c++) {
    if (out[c]) continue;
    // positional: the definition at the same index if still free, else the next free one
    const same = free.find(({ di }) => di === c);
    const pick = same ?? free[next];
    if (pick && !used.has(pick.di)) {
      used.add(pick.di);
      if (!same) next += 1;
      const display = headerRow ? headerRow[c]!.trim() : (pick.d.name ?? pick.d.ref ?? letters(c));
      out[c] = { index: c, ref: pick.d.ref ?? (headerRow ? refText(headerRow[c]!) || letters(c) : letters(c)), display, def: pick.d, how: "position" };
      if (headerRow && pick.d.ref && refKey(pick.d.ref) !== refKey(headerRow[c]!) && slug(pick.d.ref) !== slug(headerRow[c]!)) warnings.push(`column ${c + 1}: header "${headerRow[c]}" attached to definition "${pick.d.ref}" by position`);
    } else {
      // C4: no definition left.
      out[c] = { index: c, ref: headerRow ? refText(headerRow[c]!) || letters(c) : letters(c), display: headerRow ? headerRow[c]!.trim() : letters(c), how: "none" };
    }
  }
  // C1: name ignored under a header.
  if (headerRow) for (const r of out) if (r?.def?.name && r.def.name !== r.display) warnings.push(`column ${r.index + 1}: columns.name "${r.def.name}" ignored; header "${r.display}" is the display name`);
  defs.forEach((d, di) => {
    if (!used.has(di)) warnings.push(`definition ${d.ref ?? di + 1} has no CSV column (unused; formulas using it give #REF!)`);
  });
  return { columns: out as Resolved[], warnings };
}
