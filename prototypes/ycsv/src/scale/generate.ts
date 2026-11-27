import type { ColumnDef, YcsvFile } from "../ycsv-core/types";

/**
 * Scale fixtures for spike 4. Deterministic (seeded) so every run builds the same file.
 *
 * 10 columns: product, categorie, aantal, prijs, korting, tarief, totaal, netto, btw, generaal
 *   - totaal = aantal*prijs, netto = totaal*(1-korting)         per-row formulas
 *   - btw = netto*tarief1                                        cross-ref: every row reads row 1
 *   - generaal row 1 = SUM(netto1:nettoN), row 2 = SUM(btw1:btwN) whole-column aggregates
 * 30 columns: the 10 above + 10 literal measure columns (ma..mj) + 10 per-row formula columns
 *   (fa..fj) that chain inside the row (fa = ma*aantal, fb = fa+mb, …, fj = IF(fi>100,fi-100,0)).
 *
 * Column refs carry no digits so `fa12` cannot be read as `f` + row `a12`.
 */
export type ScaleWidth = 10 | 30;
export type Notation = "absolute" | "current";

const CATEGORIES = ["fruit", "zuivel", "bakkerij", "dranken", "groente"];
const RATES = [0, 0.05, 0.1, 0.15];
const LETTERS = "abcdefghij";

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scaleColumns(width: ScaleWidth): ColumnDef[] {
  const eur = { type: "currency" as const, currency: "EUR", locale: "nl-NL" };
  const base: ColumnDef[] = [
    { ref: "product", type: "string" },
    { ref: "categorie", type: "string" },
    { ref: "aantal", type: "number" },
    { ref: "prijs", ...eur },
    { ref: "korting", type: "percent" },
    { ref: "tarief", type: "percent" },
    { ref: "totaal", ...eur },
    { ref: "netto", ...eur },
    { ref: "btw", ...eur },
    { ref: "generaal", ...eur },
  ];
  if (width === 10) return base;
  for (const l of LETTERS) base.push({ ref: `m${l}`, type: "number" });
  for (const l of LETTERS) base.push({ ref: `f${l}`, type: "number" });
  return base;
}

/** `ref` in the given notation for row `n` (1-based). `current` means the formula's own row. */
function at(ref: string, n: number, notation: Notation): string {
  return notation === "current" ? ref : `${ref}${n}`;
}

export function buildScaleFile(rowCount: number, width: ScaleWidth, notation: Notation = "absolute"): YcsvFile {
  const rnd = mulberry32(20261126);
  const columns = scaleColumns(width);
  const header = columns.map((column) => column.ref ?? "");
  const rows: string[][] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const n = i + 1;
    const a = (ref: string) => at(ref, n, notation);
    const aantal = 1 + Math.floor(rnd() * 50);
    const cents = 45 + Math.floor(rnd() * (8995 - 45 + 1));
    const rate = RATES[Math.floor(rnd() * RATES.length)] ?? 0;
    let generaal = "";
    if (n === 1) generaal = `=SUM(netto1:netto${rowCount})`;
    else if (n === 2) generaal = `=SUM(btw1:btw${rowCount})`;
    const row = [
      `Product ${String(n).padStart(6, "0")}`,
      CATEGORIES[i % CATEGORIES.length] ?? "fruit",
      String(aantal),
      (cents / 100).toFixed(2),
      String(rate),
      n === 1 ? "0.21" : "",
      `=${a("aantal")}*${a("prijs")}`,
      `=${a("totaal")}*(1-${a("korting")})`,
      `=${a("netto")}*tarief1`,
      generaal,
    ];
    if (width === 30) {
      for (let k = 0; k < 10; k += 1) row.push(String(Math.floor(rnd() * 1000) / 10));
      row.push(`=${a("ma")}*${a("aantal")}`);
      for (let k = 1; k < 9; k += 1) row.push(`=${a(`f${LETTERS[k - 1]}`)}+${a(`m${LETTERS[k]}`)}`);
      row.push(`=IF(${a("fi")}>100,${a("fi")}-100,0)`);
    }
    rows.push(row);
  }
  return { frontmatter: { ycsv_version: 1, name: `Scale ${rowCount}x${width}`, columns }, columns, header, rows };
}
