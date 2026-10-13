import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Y from "yjs";
import { parse } from "../src/ycsv-core/parse";
import { serialize } from "../src/ycsv-core/serialize";
import type { YcsvFile } from "../src/ycsv-core/types";
import { evaluateAll, type RawCells } from "../src/ycsv-formula";
import { fileToDoc } from "../src/ycsv-model/doc";

const ROWS = 1200;
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

function buildFile(): YcsvFile {
  const rnd = mulberry32(20261013);
  const columns = [
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
  const header = columns.map((column) => column.ref);
  const rows: string[][] = [];
  for (let i = 0; i < ROWS; i += 1) {
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
      `=aantal${n}*prijs${n}`,
      `=totaal${n}*(1-korting${n})`,
      n === 1 ? `=SUM(netto1:netto${ROWS})` : "",
    ]);
  }
  const frontmatter = {
    ycsv_version: 1,
    name: "Groot",
    columns,
  };
  return { frontmatter, columns, header, rows };
}

function generaalValue(text: string): unknown {
  const file = parse(text);
  const doc = new Y.Doc();
  fileToDoc(file, doc);
  const columns = doc.getArray<Y.Map<unknown>>("columns");
  const rowMaps = doc.getArray<Y.Map<unknown>>("rows");
  const raw: RawCells = new Map();
  const rowOrder: string[] = [];
  const refs: string[] = [];
  for (let i = 0; i < columns.length; i += 1) refs.push(String(columns.get(i).get("ref") ?? ""));
  for (let i = 0; i < rowMaps.length; i += 1) {
    const row = rowMaps.get(i);
    const rowId = String(row.get("rowId") ?? "");
    rowOrder.push(rowId);
    const cells = row.get("cells") as Y.Map<string>;
    for (let c = 0; c < columns.length; c += 1) {
      const colId = String(columns.get(c).get("colId") ?? "");
      raw.set(`${refs[c]}@${rowId}`, cells.get(colId) ?? "");
    }
  }
  return evaluateAll(raw, rowOrder, {}).get(`generaal@${rowOrder[0]}`);
}

const file = buildFile();
const text = serialize(file);
if (serialize(parse(text)) !== text) {
  console.error("serialize(parse(content)) !== content");
  process.exit(1);
}
const value = generaalValue(text);
if (typeof value !== "number" || !Number.isFinite(value)) {
  console.error("generaal did not evaluate to a finite number:", value);
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../src/stories/fixtures/large.ycsv");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, text);
const kb = Buffer.byteLength(text) / 1024;
console.log(`wrote ${target}`);
console.log(`bytes ${Buffer.byteLength(text)}`);
console.log(`kb ${kb.toFixed(1)}`);
console.log(`generaal ${value}`);
