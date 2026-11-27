// Spike 11: header detection for a sheet without an explicit `header` flag (spec §4.1 as
// amended by P2/P27, accepted). The guess is written back as `header: true|false`; after
// that the flag wins and detection never runs again for that file.

const NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/; // P8 canonical number
const ACCOUNTING = /^\(\d+(\.\d+)?\)$/; // §7.3
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$|^\d{2}:\d{2}(:\d{2})?$/;

export type Kind = "empty" | "text" | "number" | "date" | "boolean" | "formula" | "literal";

export function kind(v: string): Kind {
  const t = v.trim();
  if (t === "") return "empty";
  if (t.startsWith("=")) return "formula";
  if (t.startsWith("'")) return "literal";
  if (/^(true|false)$/i.test(t)) return "boolean";
  if (NUMBER.test(t) || ACCOUNTING.test(t)) return "number";
  if (ISO.test(t)) return "date";
  return "text";
}

export type Detection = { header: boolean; rule: string };

/**
 * `rows`: the CSV body. `columns`: the frontmatter column definitions, if any.
 * Rules are applied in order; the first that decides wins.
 */
export function detectHeader(rows: string[][], columns?: { ref?: string; name?: string }[]): Detection {
  const body = rows.filter((r) => r.some((v) => v.trim() !== ""));
  const first = rows[0];
  if (!first || first.every((v) => v.trim() === "")) return { header: false, rule: "D1: first line empty or missing" };
  const cells = first.map((v) => v.trim());

  if (columns?.length) {
    const known = new Set(columns.flatMap((c) => [c.ref, c.name]).filter((x): x is string => !!x).map((x) => x.trim().toLowerCase()));
    const nonEmpty = cells.filter((v) => v !== "");
    const match = nonEmpty.length > 0 && nonEmpty.every((v) => known.has(v.toLowerCase()));
    return { header: match, rule: match ? "D2: every value matches a column ref or name" : "D2: a value matches no column ref or name" };
  }

  if (body.length < 2) return { header: false, rule: "D3: fewer than two non-empty rows" };
  const kinds = cells.map(kind);
  const bad = kinds.findIndex((k) => k !== "text");
  if (bad >= 0) return { header: false, rule: `D4: row 1 has a ${kinds[bad]} value (${JSON.stringify(first[bad])})` };
  const lower = cells.map((v) => v.toLowerCase());
  if (new Set(lower).size !== lower.length) return { header: false, rule: "D5: row 1 has duplicate values" };

  const below = rows.slice(1).filter((r) => r.some((v) => v.trim() !== ""));
  const typedColumn = cells.some((_, c) => below.some((r) => !["text", "empty", "literal"].includes(kind(r[c] ?? ""))));
  if (typedColumn) return { header: true, rule: "D6: text row 1 above a column with numbers, dates, booleans or formulas" };
  const repeats = cells.some((v, c) => below.some((r) => (r[c] ?? "").trim().toLowerCase() === v.toLowerCase()));
  if (repeats) return { header: false, rule: "D7: all text and a row-1 value repeats in its column" };
  return { header: true, rule: "D7: all text, row-1 values unique and not repeated below (weakest guess)" };
}
