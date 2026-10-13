import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Y from "yjs";
import { parse } from "../src/ycsv-core/parse";
import { serialize } from "../src/ycsv-core/serialize";
import { evaluateAll, type RawCells } from "../src/ycsv-formula";
import { fileToDoc } from "../src/ycsv-model/doc";
import { buildLargeFile } from "../src/stories/large-sheet";

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

const file = buildLargeFile(1200);
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
