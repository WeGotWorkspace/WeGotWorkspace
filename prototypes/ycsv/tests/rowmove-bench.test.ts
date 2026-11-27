/**
 * Spike 9 benchmark: size and speed of the three layouts on spike 4's fixture
 * (10 columns, per-row formulas, two whole-column SUMs), in Node.
 * Opt-in: RUN_BENCH=1 pnpm exec vitest run tests/rowmove-bench.test.ts
 * BENCH_SIZES=10000,50000 (default). Results: console + results/rowmove-bench.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterAll, describe, test } from "vitest";
import * as Y from "yjs";
import { buildScaleFile } from "../src/stories/scale-file";
import { toIdForm, type ColInfo } from "../src/ycsv-model/refs";
import {
  baselineLayout,
  createFracMapLayout,
  orderArrayLayout,
  rowKeyLengths,
  type SeedCol,
  type SeedRow,
  type SheetLayout,
} from "../src/ycsv-layout";
import { mulberry32 } from "./rowmove-harness";

const RUN = process.env.RUN_BENCH === "1";
const SIZES = (process.env.BENCH_SIZES ?? "10000,50000").split(",").map(Number);

const id11 = (prefix: string, i: number) => `${prefix}_${(i * 2654435761 % 2 ** 40).toString(36).padStart(11, "0")}`;

function fixture(rowsN: number): { cols: SeedCol[]; rows: SeedRow[] } {
  const file = buildScaleFile(rowsN, 10, "absolute");
  const cols: SeedCol[] = file.columns.map((col, i) => ({ id: id11("c", i + 1), ref: col.ref ?? "" }));
  const rowIds = file.rows.map((_, i) => id11("r", i + 1));
  const infos: ColInfo[] = cols.map((col) => ({ colId: col.id, ref: col.ref }));
  const rows: SeedRow[] = file.rows.map((data, i) => ({
    id: rowIds[i] as string,
    cells: Object.fromEntries(cols.map((col, j) => [col.id, toIdForm(data[j] ?? "", infos, rowIds)])),
  }));
  return { cols, rows };
}

const time = (fn: () => void): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] ?? 0;
const kib = (n: number) => Math.round(n / 1024);
const ms = (n: number) => Math.round(n * 10) / 10;

function sizes(doc: Y.Doc) {
  const v1 = Y.encodeStateAsUpdate(doc);
  return { v1: kib(v1.length), v2: kib(Y.encodeStateAsUpdateV2(doc).length), gz: kib(gzipSync(v1).length) };
}

function readAll(layout: SheetLayout, doc: Y.Doc): number {
  const rows = layout.rowOrder(doc);
  const cols = layout.colOrder(doc);
  let n = 0;
  for (const r of rows) for (const c of cols) if (layout.cell(doc, r, c)) n += 1;
  return n;
}

function bench(name: string, make: () => SheetLayout, rowsN: number, f: ReturnType<typeof fixture>) {
  const rng = mulberry32(42);
  const layout = make();
  const out: Record<string, unknown> = { layout: name, rows: rowsN };
  const doc = new Y.Doc();
  doc.clientID = 1;
  out.seedMs = ms(time(() => layout.seed(doc, f.cols, f.rows)));
  out.size = sizes(doc);

  const update = Y.encodeStateAsUpdate(doc);
  const open = new Y.Doc();
  out.applyUpdateMs = ms(time(() => Y.applyUpdate(open, update, "remote")));
  out.firstOrderMs = ms(time(() => layout.rowOrder(open)));
  out.readAllMs = ms(time(() => readAll(layout, open)));
  open.destroy();

  const colIds = layout.colOrder(doc);
  const pickRow = () => {
    const order = layout.rowOrder(doc);
    return order[Math.floor(rng() * order.length)] as string;
  };

  const edits: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    const r = pickRow();
    const c = colIds[2] as string;
    edits.push(time(() => layout.setCell(doc, r, c, String(i))));
  }
  out.editMs = { med: ms(median(edits)), p95: ms(p95(edits)) };

  const inserts: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const before = layout.rowOrder(doc)[Math.floor(rowsN / 2)] ?? null;
    inserts.push(time(() => layout.insertRow(doc, `ins_${i}`, before)));
  }
  out.insertMs = { med: ms(median(inserts)), p95: ms(p95(inserts)) };

  const moves: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const r = pickRow();
    let before = pickRow();
    if (before === r) before = layout.rowOrder(doc)[0] as string;
    moves.push(time(() => layout.moveRows(doc, [r], before)));
  }
  out.move1Ms = { med: ms(median(moves)), p95: ms(p95(moves)) };

  const blocks: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const order = layout.rowOrder(doc);
    const start = Math.floor(rng() * (order.length - 200));
    const block = order.slice(start, start + 100);
    const before = order[(start + 5000) % order.length] as string;
    blocks.push(time(() => layout.moveRows(doc, block, block.includes(before) ? null : before)));
  }
  out.move100Ms = ms(median(blocks));

  out.sizeAfter50Moves = sizes(doc);
  for (let i = 0; i < 950; i += 1) {
    const r = pickRow();
    const before = pickRow();
    if (before !== r) layout.moveRows(doc, [r], before);
  }
  out.sizeAfter1000Moves = sizes(doc);

  out.sortMs = ms(time(() => layout.sortRows(doc, colIds[3] as string)));
  out.readAfterSortMs = ms(time(() => readAll(layout, doc)));
  out.sizeAfterSort = sizes(doc);
  if (name !== "baseline") {
    // Four more sorts on other columns: how the sidecar grows with repeated sorts.
    const more: number[] = [];
    for (const c of [0, 2, 4, 3]) more.push(time(() => layout.sortRows(doc, colIds[c] as string, c === 2)));
    out.moreSortsMs = more.map(ms);
    out.sizeAfter5Sorts = sizes(doc);
  }
  doc.destroy();
  return out;
}

function keyGrowth(rowsN: number, f: ReturnType<typeof fixture>) {
  const layout = createFracMapLayout(mulberry32(3));
  const doc = new Y.Doc();
  layout.seed(doc, f.cols, f.rows);
  const seeded = rowKeyLengths(doc);
  // Enter-Enter-Enter in the middle: each new row goes right below the one just inserted.
  let anchor = layout.rowOrder(doc)[Math.floor(rowsN / 2) + 1] as string;
  for (let i = 0; i < 1000; i += 1) {
    layout.insertRow(doc, `seq_${i}`, anchor);
    void anchor;
  }
  const sequentialSameGap = rowKeyLengths(doc);
  anchor = layout.rowOrder(doc)[10] as string;
  const order = () => layout.rowOrder(doc);
  for (let i = 0; i < 1000; i += 1) {
    const o = order();
    layout.insertRow(doc, `nxt_${i}`, o[o.indexOf(`nxt_${i - 1}`) + 1] ?? anchor);
  }
  const sequentialWalk = rowKeyLengths(doc);
  const sorted = (() => {
    layout.sortRows(doc, f.cols[0]?.id as string);
    return rowKeyLengths(doc);
  })();
  return { rows: rowsN, seeded, sequentialSameGap, sequentialWalk, afterSort: sorted };
}

function migration(rowsN: number, f: ReturnType<typeof fixture>) {
  const old = new Y.Doc();
  baselineLayout.seed(old, f.cols, f.rows);
  const target = createFracMapLayout();
  const fresh = new Y.Doc();
  const t = time(() => {
    const cols = baselineLayout.colOrder(old).map((id) => ({ id, ref: baselineLayout.colRef(old, id) ?? "" }));
    const rows = baselineLayout.rowOrder(old).map((id) => ({
      id,
      cells: Object.fromEntries(cols.map((c) => [c.id, baselineLayout.cell(old, id, c.id) ?? ""])),
    }));
    target.seed(fresh, cols, rows);
  });
  return { rows: rowsN, baselineToFracMs: ms(t) };
}

const results: unknown[] = [];
const LAYOUTS: [string, () => SheetLayout][] = [
  ["baseline", () => baselineLayout],
  ["order-array", () => orderArrayLayout],
  ["frac-map", () => createFracMapLayout(mulberry32(9))],
];

describe.skipIf(!RUN)("spike 9 bench", () => {
  for (const n of SIZES) {
    let f: ReturnType<typeof fixture> | undefined;
    const data = () => (f ??= fixture(n));
    for (const [name, make] of LAYOUTS) {
      test(`${name} ${n}`, () => {
        const r = bench(name, make, n, data());
        console.log(JSON.stringify(r));
        results.push(r);
      }, 600_000);
    }
    test(`key growth + migration ${n}`, () => {
      for (const r of [keyGrowth(n, data()), migration(n, data())]) {
        console.log(JSON.stringify(r));
        results.push(r);
      }
    }, 600_000);
  }
  afterAll(() => {
    mkdirSync("results", { recursive: true });
    writeFileSync(
      "results/rowmove-bench.json",
      JSON.stringify({ at: new Date().toISOString(), node: process.version, results }, null, 1),
    );
  });
});
