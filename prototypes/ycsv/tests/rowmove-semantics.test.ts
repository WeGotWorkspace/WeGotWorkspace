/**
 * Spike 9: targeted cases for row/column moves under concurrency, per layout.
 * Peers start from one seed (rows r0..r5, columns c0..c2), act concurrently,
 * then `syncAll` (a reconnect). Baseline expectations document what is lost today.
 */
import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { evaluateAll, type RawCells } from "../src/ycsv-formula";
import { serialize } from "../src/ycsv-core/serialize";
import {
  baselineLayout,
  createFracMapLayout,
  guardedUndo,
  layoutToFile,
  orderArrayLayout,
  type SheetLayout,
} from "../src/ycsv-layout";
import { mulberry32, peers, snapshot, syncAll } from "./rowmove-harness";
import { workbookLayout } from "./rowmove-workbook-layout";

const SAFE: [string, () => SheetLayout][] = [
  ["order-array", () => orderArrayLayout],
  ["frac-map", () => createFracMapLayout(mulberry32(7))],
  ["workbook", () => workbookLayout],
];

function same(layout: SheetLayout, ...docs: Y.Doc[]) {
  const first = JSON.stringify(snapshot(layout, docs[0] as Y.Doc));
  for (const doc of docs) expect(JSON.stringify(snapshot(layout, doc))).toBe(first);
}

const undoOf = (layout: SheetLayout, doc: Y.Doc) =>
  new Y.UndoManager(layout.roots(doc), { trackedOrigins: new Set(["local"]), captureTimeout: 0 });

describe.each(SAFE)("%s: concurrent move intent", (_name, make) => {
  test("move + edit in the moved row: the edit survives, the row is at the target", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.moveRows(a, ["r1"], "r4");
    layout.setCell(b, "r1", "c1", "edited");
    syncAll([a, b]);
    same(layout, a, b);
    expect(layout.rowOrder(a)).toEqual(["r0", "r2", "r3", "r1", "r4", "r5"]);
    expect(layout.cell(a, "r1", "c1")).toBe("edited");
  });

  test("move + move of one row to different targets: one copy, at one target, same everywhere", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.moveRows(a, ["r1"], null);
    layout.moveRows(b, ["r1"], "r4");
    syncAll([a, b]);
    same(layout, a, b);
    const order = layout.rowOrder(a);
    expect(order.filter((id) => id === "r1")).toHaveLength(1);
    expect([
      ["r0", "r2", "r3", "r4", "r5", "r1"],
      ["r0", "r2", "r3", "r1", "r4", "r5"],
    ]).toContainEqual(order);
  });

  test("move + delete of one row: delete wins", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.moveRows(a, ["r1"], null);
    layout.deleteRow(b, "r1");
    syncAll([a, b]);
    same(layout, a, b);
    expect(layout.rowOrder(a)).toEqual(["r0", "r2", "r3", "r4", "r5"]);
  });

  test("move + insert: both land; an insert anchored on the moved row lands at its old place", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.moveRows(a, ["r2"], null);
    layout.insertRow(b, "n1", "r2");
    layout.insertRow(b, "n2", "r4");
    syncAll([a, b]);
    same(layout, a, b);
    expect(layout.rowOrder(a)).toEqual(["r0", "r1", "n1", "r3", "n2", "r4", "r5", "r2"]);
  });

  test("sort while others edit: edits survive, the order is the sort", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    // c0 holds 100, 93, 86, …: ascending sort reverses the rows.
    layout.sortRows(a, "c0");
    layout.setCell(b, "r0", "c1", "during-sort");
    layout.setCell(b, "r5", "c2", "also");
    syncAll([a, b]);
    same(layout, a, b);
    expect(layout.rowOrder(a)).toEqual(["r5", "r4", "r3", "r2", "r1", "r0"]);
    expect(layout.cell(a, "r0", "c1")).toBe("during-sort");
    expect(layout.cell(a, "r5", "c2")).toBe("also");
  });

  test("sort + sort on different columns: exactly one of the two sorts wins", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.setCell(a, "r3", "c2", "a");
    syncAll([a, b]);
    layout.sortRows(a, "c0");
    layout.sortRows(b, "c2");
    const sortA = layout.rowOrder(a);
    const sortB = layout.rowOrder(b);
    syncAll([a, b]);
    same(layout, a, b);
    expect([sortA, sortB]).toContainEqual(layout.rowOrder(a));
  });

  test("two multi-row drags into the same gap stay contiguous blocks", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const layout = _name === "frac-map" ? createFracMapLayout(mulberry32(seed)) : make();
      const [a, b] = peers(layout, 2, 8) as [Y.Doc, Y.Doc];
      layout.moveRows(a, ["r0", "r1"], "r6");
      layout.moveRows(b, ["r2", "r3"], "r6");
      syncAll([a, b]);
      same(layout, a, b);
      const order = layout.rowOrder(a).join(",");
      expect(order.includes("r0,r1") && order.includes("r2,r3")).toBe(true);
      expect(order.endsWith("r6,r7")).toBe(true);
    }
  });

  test("overlapping multi-row drags: every row once, nothing lost", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.moveRows(a, ["r1", "r2"], null);
    layout.moveRows(b, ["r2", "r3"], "r0");
    layout.setCell(b, "r2", "c1", "kept");
    syncAll([a, b]);
    same(layout, a, b);
    expect([...layout.rowOrder(a)].sort()).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
    expect(layout.cell(a, "r2", "c1")).toBe("kept");
  });
});

describe.each(SAFE)("%s: per-user undo of a move", (_name, make) => {
  test("undo puts the row back; a peer's concurrent edit in it stays", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    const undo = undoOf(layout, a);
    layout.moveRows(a, ["r1"], null);
    layout.setCell(b, "r1", "c1", "peer");
    syncAll([a, b]);
    undo.undo();
    syncAll([a, b]);
    same(layout, a, b);
    expect(layout.rowOrder(a)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
    expect(layout.cell(a, "r1", "c1")).toBe("peer");
  });

  test("undo after a peer moved the same row later", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    const undo = undoOf(layout, a);
    layout.moveRows(a, ["r1"], null);
    syncAll([a, b]);
    layout.moveRows(b, ["r1"], "r4");
    syncAll([a, b]);
    undo.undo();
    syncAll([a, b]);
    same(layout, a, b);
    const order = layout.rowOrder(a);
    expect(order.filter((id) => id === "r1")).toHaveLength(1);
    if (_name === "frac-map") {
      // Map LWW: my old key is not restored over the peer's newer one. Peer's move stays.
      expect(order).toEqual(["r0", "r2", "r3", "r1", "r4", "r5"]);
    } else {
      // Array: undo restores my original entry; it comes first, so the row jumps back
      // over the peer's newer move. Converges, but against the peer's intent.
      expect(order).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
    }
  });

  test("both movers of one row undo: the row stays visible, deterministic, repairable", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    const undoA = undoOf(layout, a);
    const undoB = undoOf(layout, b);
    layout.moveRows(a, ["r1"], null);
    layout.moveRows(b, ["r1"], "r4");
    syncAll([a, b]);
    undoA.undo();
    undoB.undo();
    syncAll([a, b]);
    same(layout, a, b);
    const order = layout.rowOrder(a);
    expect([...order].sort()).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
    const stats = layout.stats(a);
    layout.repair?.(a);
    syncAll([a, b]);
    same(layout, a, b);
    expect(layout.rowOrder(a)).toEqual(order);
    expect(layout.stats(a)).toMatchObject({ duplicateRows: 0, orphanOrderRows: 0, tiedRows: 0 });
    console.log(`${_name}: double undo of one row → order ${order.join(",")}, raw stats before repair ${JSON.stringify(stats)}`);
  });
});

describe.each(SAFE)("%s: columns", (_name, make) => {
  test("move column + rename it + edit its cells concurrently: all survive", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.moveCol(a, "c0", null);
    layout.renameCol(b, "c0", "renamed");
    layout.setCell(b, "r2", "c0", "cell");
    syncAll([a, b]);
    same(layout, a, b);
    expect(layout.colOrder(a)).toEqual(["c1", "c2", "c0"]);
    expect(layout.colRef(a, "c0")).toBe("renamed");
    expect(layout.cell(a, "r2", "c0")).toBe("cell");
  });

  test("move + move column: one copy; move + delete column: deleted", () => {
    const layout = make();
    const [a, b, c] = peers(layout, 3) as [Y.Doc, Y.Doc, Y.Doc];
    layout.moveCol(a, "c0", null);
    layout.moveCol(b, "c0", "c2");
    layout.moveCol(c, "c1", null);
    layout.deleteCol(a, "c1");
    syncAll([a, b, c]);
    same(layout, a, b, c);
    expect(layout.colOrder(a).filter((id) => id === "c0")).toHaveLength(1);
    expect(layout.colOrder(a)).not.toContain("c1");
  });
});

describe("baseline (today): what a move loses", () => {
  const layout = baselineLayout;

  test("move + edit in the moved row: the edit is lost", () => {
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.moveRows(a, ["r1"], "r4");
    layout.setCell(b, "r1", "c1", "edited");
    syncAll([a, b]);
    same(layout, a, b);
    expect(layout.cell(a, "r1", "c1")).toBe("v11");
  });

  test("move + move: the row appears twice", () => {
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.moveRows(a, ["r1"], null);
    layout.moveRows(b, ["r1"], "r4");
    syncAll([a, b]);
    expect(layout.rowOrder(a).filter((id) => id === "r1")).toHaveLength(2);
  });

  test("move + delete: the deleted row comes back", () => {
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.moveRows(a, ["r1"], null);
    layout.deleteRow(b, "r1");
    syncAll([a, b]);
    expect(layout.rowOrder(a)).toContain("r1");
  });

  test("sort while others edit: every concurrent edit is lost; sort + sort doubles every row", () => {
    const [a, b, c] = peers(layout, 3) as [Y.Doc, Y.Doc, Y.Doc];
    layout.sortRows(a, "c0");
    layout.setCell(b, "r0", "c1", "during-sort");
    layout.sortRows(c, "c2");
    syncAll([a, b, c]);
    expect(layout.cell(a, "r0", "c1")).toBe("v01");
    expect(layout.rowOrder(a)).toHaveLength(12);
  });

  test("column move + rename: the rename is lost (cells survive: they are keyed by column id)", () => {
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.moveCol(a, "c0", null);
    layout.renameCol(b, "c0", "renamed");
    layout.setCell(b, "r2", "c0", "cell");
    syncAll([a, b]);
    expect(layout.colRef(a, "c0")).toBe("ka");
    expect(layout.cell(a, "r2", "c0")).toBe("cell");
  });
});

/** Values via the real formula engine, rows in the layout's resolved order. */
function values(layout: SheetLayout, doc: Y.Doc) {
  const cols = layout.colOrder(doc).map((colId) => ({ colId, ref: layout.colRef(doc, colId) ?? "" }));
  const order = layout.rowOrder(doc);
  const raw: RawCells = new Map();
  for (const r of order) for (const c of cols) raw.set(`${c.ref}@${r}`, layout.cell(doc, r, c.colId) ?? "");
  return evaluateAll(raw, order, {}, cols.map((c) => c.ref));
}

describe.each(SAFE)("%s: formula refs after moves and sort", (_name, make) => {
  function sheet() {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    // ka holds 100, 93, 86, 79, 72, 65 (rows r0..r5). Formulas live in column c2 (kc).
    layout.setCell(a, "r0", "c2", "=SUM(ka@r0:ka@r3)");
    layout.setCell(a, "r1", "c2", "=ka@r3*2");
    syncAll([a, b]);
    return { layout, a, b };
  }
  const fileRow = (layout: SheetLayout, doc: Y.Doc, rowId: string) =>
    layoutToFile(layout, doc).rows[layout.rowOrder(doc).indexOf(rowId)] ?? [];

  test("a point ref follows its row; the file form shows the new row number", () => {
    const { layout, a } = sheet();
    expect(fileRow(layout, a, "r1")[2]).toBe("=ka4*2");
    layout.moveRows(a, ["r3"], "r0");
    expect(fileRow(layout, a, "r1")[2]).toBe("=ka1*2");
    expect(values(layout, a).get("kc@r1")).toBe(158);
  });

  test("a range is 'from row a to row b in the current order': rows moved out leave, rows moved in join", () => {
    const { layout, a } = sheet();
    expect(values(layout, a).get("kc@r0")).toBe(100 + 93 + 86 + 79);
    layout.moveRows(a, ["r1"], null);
    expect(fileRow(layout, a, "r0")[2]).toBe("=SUM(ka1:ka3)");
    expect(values(layout, a).get("kc@r0")).toBe(100 + 86 + 79);
    layout.moveRows(a, ["r5"], "r2");
    expect(fileRow(layout, a, "r0")[2]).toBe("=SUM(ka1:ka4)");
    expect(values(layout, a).get("kc@r0")).toBe(100 + 65 + 86 + 79);
  });

  test("moving an endpoint row stretches the range to it (Excel cut + insert semantics)", () => {
    const { layout, a } = sheet();
    layout.moveRows(a, ["r3"], null);
    expect(fileRow(layout, a, "r0")[2]).toBe("=SUM(ka1:ka6)");
    expect(values(layout, a).get("kc@r0")).toBe(100 + 93 + 86 + 72 + 65 + 79);
  });

  test("sort keeps a range's positions (Excel/Sheets: sort moves values, not the frame)", () => {
    const { layout, a } = sheet();
    // Whole-column-ish range over r0..r5 in the second formula slot.
    layout.setCell(a, "r2", "c2", "=SUM(ka@r0:ka@r5)");
    layout.sortRows(a, "c0");
    const file = layoutToFile(layout, a);
    const order = layout.rowOrder(a);
    expect(order).toEqual(["r5", "r4", "r3", "r2", "r1", "r0"]);
    // Positions 1..4 and 1..6 again, now over the sorted values.
    expect(file.rows[order.indexOf("r0")]?.[2]).toBe("=SUM(ka1:ka4)");
    expect(file.rows[order.indexOf("r2")]?.[2]).toBe("=SUM(ka1:ka6)");
    expect(values(layout, a).get("kc@r2")).toBe(100 + 93 + 86 + 79 + 72 + 65);
    expect(values(layout, a).get("kc@r0")).toBe(65 + 72 + 79 + 86);
    // The point ref still follows its row (r3), not the position.
    expect(file.rows[order.indexOf("r1")]?.[2]).toBe("=ka3*2");
  });

  test("a range edited concurrently with a sort is not rewritten (known gap)", () => {
    const { layout, a, b } = sheet();
    layout.sortRows(a, "c0");
    layout.setCell(b, "r4", "c2", "=SUM(ka@r0:ka@r5)");
    syncAll([a, b]);
    same(layout, a, b);
    // Endpoints by id: after the sort r0 is last and r5 first, so the range is reversed.
    expect(layoutToFile(layout, a).rows[layout.rowOrder(a).indexOf("r4")]?.[2]).toBe("=SUM(ka6:ka1)");
  });

  test("YCSV serialization is the resolved order and is identical on every peer", () => {
    const { layout, a, b } = sheet();
    layout.moveRows(a, ["r4", "r5"], "r0");
    layout.moveCol(b, "c2", "c0");
    syncAll([a, b]);
    const text = serialize(layoutToFile(layout, a));
    expect(serialize(layoutToFile(layout, b))).toBe(text);
    expect(text).toContain("kc,ka,kb");
    expect(text.split("\n").find((line) => line.startsWith("=SUM"))).toBe("=SUM(ka3:ka6),100,v01");
  });
});

describe("order-array: undo guard", () => {
  test("undo after a peer moved the row later is dropped: the peer's move stays", () => {
    const layout = orderArrayLayout;
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    const undo = undoOf(layout, a);
    layout.moveRows(a, ["r1"], null);
    syncAll([a, b]);
    layout.moveRows(b, ["r1"], "r4");
    syncAll([a, b]);
    expect(guardedUndo(a, undo)).toBe("dropped");
    syncAll([a, b]);
    expect(layout.rowOrder(a)).toEqual(["r0", "r2", "r3", "r1", "r4", "r5"]);
  });

  test("my own move, move, undo, undo still reverts both (redone links are followed)", () => {
    const layout = orderArrayLayout;
    const [a] = peers(layout, 1) as [Y.Doc];
    const undo = undoOf(layout, a);
    layout.moveRows(a, ["r1"], null);
    layout.moveRows(a, ["r1"], "r3");
    expect(guardedUndo(a, undo)).toBe("undone");
    expect(layout.rowOrder(a)).toEqual(["r0", "r2", "r3", "r4", "r5", "r1"]);
    expect(guardedUndo(a, undo)).toBe("undone");
    expect(layout.rowOrder(a)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
    undo.redo();
    expect(layout.rowOrder(a)).toEqual(["r0", "r2", "r3", "r4", "r5", "r1"]);
  });

  test("a peer's edit in the row does not make my move stale", () => {
    const layout = orderArrayLayout;
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    const undo = undoOf(layout, a);
    layout.moveRows(a, ["r1"], null);
    layout.setCell(b, "r1", "c0", "x");
    syncAll([a, b]);
    expect(guardedUndo(a, undo)).toBe("undone");
    expect(layout.rowOrder(a)[1]).toBe("r1");
  });
});

describe.each(SAFE)("%s: sort racing a structural op", (name, make) => {
  test("sort + insert anchored on a row: the row is kept; where it lands differs per layout", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.sortRows(a, "c0");
    layout.insertRow(b, "n1", "r3");
    syncAll([a, b]);
    same(layout, a, b);
    const order = layout.rowOrder(a);
    expect(order.filter((id) => id.startsWith("r"))).toEqual(["r5", "r4", "r3", "r2", "r1", "r0"]);
    // order-array: the anchor's old entry is a tombstone after the sorted run → end.
    // frac-map: the key was cut between old keys a2/a3 → position 3 in the new key space.
    console.log(`${name}: sort + insert before r3 → ${order.join(",")}`);
    expect(order.indexOf("n1")).toBe(name === "frac-map" ? 3 : 6);
  });

  test("sort + move of one row: sort wins (order-array) or per-row last writer (frac-map)", () => {
    const layout = make();
    const [a, b] = peers(layout, 2) as [Y.Doc, Y.Doc];
    layout.sortRows(a, "c0");
    layout.moveRows(b, ["r0"], "r2");
    syncAll([a, b]);
    same(layout, a, b);
    const order = layout.rowOrder(a);
    console.log(`${name}: sort + move r0 before r2 → ${order.join(",")}`);
    expect([...order].sort()).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
  });
});
