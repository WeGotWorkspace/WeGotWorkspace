/**
 * Spike 9: randomized multi-doc fuzz over the three row/column layouts.
 *
 * 4 peers, random ops on random peers, random one-way syncs in between (so ops
 * are concurrent in random shapes), then a full sync. Asserted per run:
 *   - convergence: every peer shows the same rows, columns, refs and cells;
 *   - no lost edits: a cell written once (row and column never deleted) has
 *     that value; a cell written more than once has one of the written values;
 *   - no duplicate rows/columns, no resurrected deletes, no vanished rows/columns;
 *   - a column renamed once has that name.
 * A second mode adds per-user undo and asserts convergence + structure only
 * (undo legitimately removes writes).
 */
import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { baselineLayout, createFracMapLayout, guardedUndo, orderArrayLayout, type SheetLayout } from "../src/ycsv-layout";
import { mulberry32, peers, push, snapshot, syncAll } from "./rowmove-harness";

type Tally = {
  runs: number;
  diverged: number;
  edits: number;
  lostEdits: number;
  duplicateRows: number;
  resurrectedRows: number;
  vanishedRows: number;
  duplicateCols: number;
  resurrectedCols: number;
  vanishedCols: number;
  renames: number;
  lostRenames: number;
  moves: number;
  sorts: number;
  /** Raw anomalies the read rule hides, summed over runs (before any repair). */
  rawDuplicates: number;
  rawOrphans: number;
  rawTiesOrUnplaced: number;
};

const emptyTally = (): Tally => ({
  runs: 0,
  diverged: 0,
  edits: 0,
  lostEdits: 0,
  duplicateRows: 0,
  resurrectedRows: 0,
  vanishedRows: 0,
  duplicateCols: 0,
  resurrectedCols: 0,
  vanishedCols: 0,
  renames: 0,
  lostRenames: 0,
  moves: 0,
  sorts: 0,
  rawDuplicates: 0,
  rawOrphans: 0,
  rawTiesOrUnplaced: 0,
});

type Options = { steps: number; peers: number; repair: boolean; undo: boolean; rows: number; cols: number; noSort?: boolean; guard?: boolean };

function pick<T>(rng: () => number, list: readonly T[]): T | undefined {
  return list.length === 0 ? undefined : list[Math.floor(rng() * list.length)];
}

function runOnce(makeLayout: (rng: () => number) => SheetLayout, seed: number, opts: Options, tally: Tally): void {
  const rng = mulberry32(seed);
  const layout = makeLayout(mulberry32(seed ^ 0x9e3779b9));
  const docs = peers(layout, opts.peers, opts.rows, opts.cols);
  const undos = opts.undo
    ? docs.map((doc) => new Y.UndoManager(layout.roots(doc), { trackedOrigins: new Set(["local"]), captureTimeout: 0 }))
    : [];

  const writes = new Map<string, string[]>();
  const renames = new Map<string, string[]>();
  const deletedRows = new Set<string>();
  const deletedCols = new Set<string>();
  const liveRows = new Set(layout.rowOrder(docs[0] as Y.Doc));
  const liveCols = new Set(layout.colOrder(docs[0] as Y.Doc));
  let counter = 0;

  for (let step = 0; step < opts.steps; step += 1) {
    const p = Math.floor(rng() * docs.length);
    const doc = docs[p] as Y.Doc;
    const rows = layout.rowOrder(doc);
    const cols = layout.colOrder(doc);
    const roll = rng();
    counter += 1;
    if (roll < 0.3) {
      const r = pick(rng, rows);
      const c = pick(rng, cols);
      if (!r || !c) continue;
      const value = `p${p}-${counter}`;
      layout.setCell(doc, r, c, value);
      const key = `${r}|${c}`;
      writes.set(key, [...(writes.get(key) ?? []), value]);
      tally.edits += 1;
    } else if (roll < 0.45) {
      const count = 1 + Math.floor(rng() * 3);
      const start = Math.floor(rng() * rows.length);
      const moving = rows.slice(start, start + count);
      const rest = rows.filter((id) => !moving.includes(id));
      const before = rng() < 0.2 ? null : (pick(rng, rest) ?? null);
      layout.moveRows(doc, moving, before);
      tally.moves += 1;
    } else if (roll < 0.53) {
      const id = `n${p}-${counter}`;
      layout.insertRow(doc, id, rng() < 0.2 ? null : (pick(rng, rows) ?? null));
      liveRows.add(id);
    } else if (roll < 0.58) {
      const r = pick(rng, rows);
      if (!r || rows.length < 3) continue;
      layout.deleteRow(doc, r);
      deletedRows.add(r);
    } else if (roll < 0.62) {
      const c = pick(rng, cols);
      if (!c || opts.noSort) continue;
      layout.sortRows(doc, c, rng() < 0.5);
      tally.sorts += 1;
    } else if (roll < 0.68) {
      const c = pick(rng, cols);
      if (!c) continue;
      const rest = cols.filter((id) => id !== c);
      layout.moveCol(doc, c, rng() < 0.2 ? null : (pick(rng, rest) ?? null));
      tally.moves += 1;
    } else if (roll < 0.73) {
      const c = pick(rng, cols);
      if (!c) continue;
      const ref = `ref${p}x${counter}`;
      layout.renameCol(doc, c, ref);
      renames.set(c, [...(renames.get(c) ?? []), ref]);
      tally.renames += 1;
    } else if (roll < 0.75) {
      const id = `m${p}-${counter}`;
      layout.insertCol(doc, id, `col${counter}`, pick(rng, cols) ?? null);
      liveCols.add(id);
    } else if (roll < 0.76) {
      const c = pick(rng, cols);
      if (!c || cols.length < 3) continue;
      layout.deleteCol(doc, c);
      deletedCols.add(c);
    } else if (roll < 0.8 && opts.undo) {
      const undo = undos[p];
      if (undo && opts.guard) guardedUndo(doc, undo);
      else undo?.undo();
    } else if (roll < 0.82 && opts.repair && layout.repair) {
      layout.repair(doc);
    } else {
      const q = Math.floor(rng() * docs.length);
      if (q !== p) push(doc, docs[q] as Y.Doc);
    }
  }

  syncAll(docs);
  const raw = layout.stats(docs[0] as Y.Doc);
  tally.rawDuplicates += raw.duplicateRows + raw.duplicateCols;
  tally.rawOrphans += raw.orphanOrderRows;
  tally.rawTiesOrUnplaced += raw.tiedRows + raw.tiedCols;
  if (opts.repair && layout.repair) {
    for (const doc of docs) layout.repair(doc);
    syncAll(docs);
  }

  tally.runs += 1;
  const reference = JSON.stringify(snapshot(layout, docs[0] as Y.Doc));
  // A cold replica (fresh doc, fresh order index) must read the same as the live peers.
  const cold = new Y.Doc();
  Y.applyUpdate(cold, Y.encodeStateAsUpdate(docs[0] as Y.Doc), "remote");
  if ([...docs, cold].some((doc) => JSON.stringify(snapshot(layout, doc)) !== reference)) tally.diverged += 1;

  const doc = docs[0] as Y.Doc;
  const rowOrder = layout.rowOrder(doc);
  const colOrder = layout.colOrder(doc);
  const rowCount = new Map<string, number>();
  for (const id of rowOrder) rowCount.set(id, (rowCount.get(id) ?? 0) + 1);
  const colCount = new Map<string, number>();
  for (const id of colOrder) colCount.set(id, (colCount.get(id) ?? 0) + 1);

  for (const count of rowCount.values()) if (count > 1) tally.duplicateRows += count - 1;
  for (const count of colCount.values()) if (count > 1) tally.duplicateCols += count - 1;

  if (opts.undo) {
    // Undo can bring back a deleted row or remove an inserted one: only structure is checked.
    return;
  }
  for (const id of deletedRows) if (rowCount.has(id)) tally.resurrectedRows += 1;
  for (const id of liveRows) if (!deletedRows.has(id) && !rowCount.has(id)) tally.vanishedRows += 1;
  for (const id of deletedCols) if (colCount.has(id)) tally.resurrectedCols += 1;
  for (const id of liveCols) if (!deletedCols.has(id) && !colCount.has(id)) tally.vanishedCols += 1;

  for (const [key, values] of writes) {
    const [r, c] = key.split("|") as [string, string];
    if (deletedRows.has(r) || deletedCols.has(c) || !rowCount.has(r) || !colCount.has(c)) continue;
    const final = layout.cell(doc, r, c) ?? "";
    const ok = values.length === 1 ? final === values[0] : values.includes(final);
    if (!ok) tally.lostEdits += 1;
  }
  for (const [c, refs] of renames) {
    if (deletedCols.has(c) || !colCount.has(c)) continue;
    const final = layout.colRef(doc, c) ?? "";
    const ok = refs.length === 1 ? final === refs[0] : refs.includes(final);
    if (!ok) tally.lostRenames += 1;
  }
}

const LAYOUTS: { key: string; make: (rng: () => number) => SheetLayout; repair: boolean; expectClean: boolean; noSort?: boolean; guard?: boolean }[] = [
  { key: "baseline", make: () => baselineLayout, repair: false, expectClean: false },
  { key: "baseline-no-sort", make: () => baselineLayout, repair: false, expectClean: false, noSort: true },
  { key: "order-array", make: () => orderArrayLayout, repair: false, expectClean: true },
  { key: "order-array+repair", make: () => orderArrayLayout, repair: true, expectClean: true },
  { key: "order-array+repair+guard", make: () => orderArrayLayout, repair: true, expectClean: true, guard: true },
  { key: "frac-map", make: (rng) => createFracMapLayout(rng), repair: false, expectClean: true },
  { key: "frac-map+repair", make: (rng) => createFracMapLayout(rng), repair: true, expectClean: true },
];

const RUNS = Number(process.env.FUZZ_RUNS ?? 300);
const report: Record<string, Tally> = {};

describe("spike 9 fuzz: concurrent move / sort / edit / insert / delete", () => {
  for (const entry of LAYOUTS) {
    test(`${entry.key}: ${RUNS} runs`, () => {
      const tally = emptyTally();
      for (let seed = 1; seed <= RUNS; seed += 1) {
        runOnce(entry.make, seed, { steps: 80, peers: 4, repair: entry.repair, undo: false, rows: 8, cols: 4, noSort: entry.noSort }, tally);
      }
      report[entry.key] = tally;
      expect(tally.diverged).toBe(0);
      const anomalies =
        tally.lostEdits +
        tally.duplicateRows +
        tally.resurrectedRows +
        tally.vanishedRows +
        tally.duplicateCols +
        tally.resurrectedCols +
        tally.vanishedCols +
        tally.lostRenames;
      if (entry.expectClean) expect(tally).toMatchObject({ lostEdits: 0, duplicateRows: 0, resurrectedRows: 0, vanishedRows: 0, duplicateCols: 0, resurrectedCols: 0, vanishedCols: 0, lostRenames: 0 });
      else expect(anomalies).toBeGreaterThan(0);
    }, 120_000);

    test(`${entry.key} with per-user undo: converges, no duplicates`, () => {
      const tally = emptyTally();
      for (let seed = 1; seed <= Math.ceil(RUNS / 2); seed += 1) {
        runOnce(entry.make, seed + 10_000, { steps: 80, peers: 3, repair: entry.repair, undo: true, rows: 8, cols: 4, noSort: entry.noSort, guard: entry.guard }, tally);
      }
      report[`${entry.key}+undo`] = tally;
      expect(tally.diverged).toBe(0);
      if (entry.expectClean) expect(tally).toMatchObject({ duplicateRows: 0, duplicateCols: 0 });
    }, 120_000);
  }

  test("report", () => {
    console.log(JSON.stringify(report, null, 1));
  });
});
