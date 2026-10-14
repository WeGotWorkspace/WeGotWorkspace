import type { ColumnDef, YcsvFile } from "../ycsv-core/types";

const CATEGORIES = ["fruit", "zuivel", "bakkerij", "dranken", "groente"];
const RATES = [0, 0.05, 0.1, 0.15];

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDay(index: number): string {
  const date = new Date(Date.UTC(2026, 0, 1 + index));
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

export type SheetNotation = "current" | "absolute" | "positional" | "quoted";

function formulas(notation: SheetNotation, n: number, rowCount: number): [string, string, string] {
  const generaal = n === 1 ? `=SUM(netto1:netto${rowCount})` : "";
  if (notation === "current") return ["=aantal*prijs", "=totaal*(1-korting)", generaal];
  if (notation === "positional") return [`=C${n}*D${n}`, `=G${n}*(1-E${n})`, generaal];
  if (notation === "quoted") return [`='aantal'${n}*'prijs'${n}`, `='totaal'${n}*(1-'korting'${n})`, generaal];
  return [`=aantal${n}*prijs${n}`, `=totaal${n}*(1-korting${n})`, generaal];
}

export function buildLargeFile(rowCount: number, notation: SheetNotation = "absolute"): YcsvFile {
  const rnd = mulberry32(20261013);
  const columns: ColumnDef[] = [
    { ref: "product", type: "string" },
    { ref: "categorie", type: "string" },
    { ref: "aantal", type: "number" },
    { ref: "prijs", type: "currency", currency: "EUR", locale: "nl-NL" },
    { ref: "korting", type: "percent" },
    { ref: "datum", type: "date" },
    { ref: "totaal", type: "currency", currency: "EUR", locale: "nl-NL" },
    { ref: "netto", type: "currency", currency: "EUR", locale: "nl-NL" },
    { ref: "generaal", type: "currency", currency: "EUR", locale: "nl-NL" },
  ];
  const header = columns.map((column) => column.ref ?? "");
  const rows: string[][] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const n = i + 1;
    const aantal = 1 + Math.floor(rnd() * 50);
    const cents = 45 + Math.floor(rnd() * (8995 - 45 + 1));
    const rate = RATES[Math.floor(rnd() * RATES.length)] ?? 0;
    rows.push([
      `Product ${String(n).padStart(4, "0")}`,
      CATEGORIES[i % CATEGORIES.length] ?? "fruit",
      String(aantal),
      (cents / 100).toFixed(2),
      String(rate),
      isoDay(i),
      ...formulas(notation, n, rowCount),
    ]);
  }
  const frontmatter = {
    ycsv_version: 1,
    name: "Groot",
    columns,
  };
  return { frontmatter, columns, header, rows };
}
