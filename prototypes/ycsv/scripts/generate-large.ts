import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Y from "yjs";
import { parse } from "../src/ycsv-core/parse";
import { serialize } from "../src/ycsv-core/serialize";
import { evaluateAll, type RawCells } from "../src/ycsv-formula";
import { docToFile, fileToDoc } from "../src/ycsv-model/doc";
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
  return evaluateAll(raw, rowOrder, {}, refs).get(`generaal@${rowOrder[0]}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../src/stories/fixtures");
mkdirSync(fixtures, { recursive: true });

const files = [
  ["large-a-current.ycsv", "current"],
  ["large-b-absolute.ycsv", "absolute"],
  ["large-c-positional.ycsv", "positional"],
  ["large-d-quoted.ycsv", "quoted"],
] as const;

const written: { name: string; text: string; notation: string }[] = [];
for (const [name, notation] of files) {
  const text = serialize(buildLargeFile(1200, notation));
  const canonical = notation === "current" || notation === "absolute";
  if (canonical && serialize(parse(text)) !== text) {
    console.error(`${name}: serialize(parse(content)) !== content`);
    process.exit(1);
  }
  const value = generaalValue(text);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    console.error(`${name}: generaal did not evaluate to a finite number:`, value);
    process.exit(1);
  }
  writeFileSync(resolve(fixtures, name), text);
  written.push({ name, text, notation });
  console.log(`wrote ${name} bytes ${Buffer.byteLength(text)} generaal ${value}`);
}

const parsed = written.map((file) => parse(file.text));
for (let i = 1; i < parsed.length; i += 1) {
  const left = parsed[0]?.rows ?? [];
  const right = parsed[i]?.rows ?? [];
  for (let r = 0; r < left.length; r += 1) {
    const a = left[r]?.slice(0, 6).join("|");
    const b = right[r]?.slice(0, 6).join("|");
    if (a !== b) {
      console.error(`data mismatch at row ${r + 1} between ${written[0]?.name} and ${written[i]?.name}`);
      process.exit(1);
    }
  }
}
console.log("first six columns match");

function throughModel(text: string): string {
  const doc = new Y.Doc();
  fileToDoc(parse(text), doc);
  return serialize(docToFile(doc));
}

const byName = new Map(written.map((file) => [file.notation, file.text]));
const current = byName.get("current") ?? "";
const absolute = byName.get("absolute") ?? "";
const positional = byName.get("positional") ?? "";
const quoted = byName.get("quoted") ?? "";
const checks: [string, boolean][] = [
  ["model(C) === B", throughModel(positional) === absolute],
  ["model(D) === B", throughModel(quoted) === absolute],
  ["model(A) === A", throughModel(current) === current],
  ["model(B) === B", throughModel(absolute) === absolute],
];
for (const [label, ok] of checks) console.log(label, ok);
if (checks.some(([, ok]) => !ok)) process.exit(1);
