import * as Y from "yjs";
import type { SeedCol, SeedRow, SheetLayout } from "../src/ycsv-layout";

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-way delta from `from` to `to`, like a reconnect or a relayed update. */
export function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "remote");
}

export function syncAll(docs: Y.Doc[]): void {
  for (let round = 0; round < 2; round += 1) {
    for (const from of docs) for (const to of docs) if (from !== to) push(from, to);
  }
}

export function fixture(rows = 6, cols = 3): { cols: SeedCol[]; rows: SeedRow[] } {
  const c: SeedCol[] = Array.from({ length: cols }, (_, i) => ({ id: `c${i}`, ref: `k${String.fromCharCode(97 + i)}` }));
  const r: SeedRow[] = Array.from({ length: rows }, (_, i) => ({
    id: `r${i}`,
    cells: Object.fromEntries(c.map((col, j) => [col.id, j === 0 ? String(100 - i * 7) : `v${i}${j}`])),
  }));
  return { cols: c, rows: r };
}

/** `n` peers that start from one seeded state (the seed is applied, not re-run, on peers 2..n). */
export function peers(layout: SheetLayout, n: number, rows = 6, cols = 3): Y.Doc[] {
  const docs = Array.from({ length: n }, (_, i) => {
    const doc = new Y.Doc();
    doc.clientID = i + 1;
    return doc;
  });
  const f = fixture(rows, cols);
  layout.seed(docs[0] as Y.Doc, f.cols, f.rows, "seed");
  for (const doc of docs.slice(1)) push(docs[0] as Y.Doc, doc);
  return docs;
}

/** Everything a peer shows, for convergence checks. */
export function snapshot(layout: SheetLayout, doc: Y.Doc) {
  const rows = layout.rowOrder(doc);
  const cols = layout.colOrder(doc);
  return {
    rows,
    cols: cols.map((id) => `${id}:${layout.colRef(doc, id)}`),
    cells: rows.map((r) => cols.map((c) => layout.cell(doc, r, c) ?? "")),
  };
}
