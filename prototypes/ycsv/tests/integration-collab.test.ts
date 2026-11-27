/**
 * Integration slice: spike 5's collab semantics, re-run on the workbook layout
 * (spike 9 order arrays, multi-sheet). Pure Yjs, no transport: `sync()` exchanges
 * state diffs like a reconnect. Spike 5's EditBase case is gone on purpose: the grid
 * keeps spike 6's id-form draft (refs become ids while typing), see integration-slice.md.
 */
import * as awarenessCodec from "y-protocols/awareness";
import { Awareness } from "y-protocols/awareness";
import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  buildYcsvSeed,
  createSheetUndoManager,
  guardedUndo,
  isYcsvEmpty,
  readPeerSheetPresence,
  readYcsv,
  recognisesYcsv,
  seedYcsv,
  setLocalSheetPresence,
} from "../src/sheets-core/collab";
import { WorkbookEngine } from "../src/sheets-core/engine/engine";
import {
  addSheet,
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  moveRows,
  partsOf,
  repairWorkbook,
  sheetIds,
  sheetsOf,
  SheetView,
  writeCells,
} from "../src/sheets-core/model";
import { serialize } from "../src/ycsv-core/serialize";
import { SEED } from "../src/stories/fixtures";
import { buildLargeFile } from "../src/stories/large-sheet";

function sync(...docs: Y.Doc[]) {
  for (const from of docs) {
    for (const to of docs) {
      if (from === to) continue;
      Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "remote");
    }
  }
}

function seeded(text = SEED, clientID?: number) {
  const doc = new Y.Doc();
  if (clientID !== undefined) doc.clientID = clientID;
  seedYcsv(doc, text, { origin: "seed" });
  return doc;
}

function peer(of: Y.Doc, clientID: number) {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  sync(of, doc);
  return doc;
}

const S = (doc: Y.Doc, i = 0) => ({ doc, id: sheetIds(doc)[i]! });

function view(doc: Y.Doc, i = 0) {
  const v = new SheetView(doc, sheetIds(doc)[i]!);
  const out = { rows: v.rowIds, cols: v.colIds, refs: v.colRefs };
  v.destroy();
  return out;
}

const rowId = (doc: Y.Doc, index: number) => view(doc).rows[index]!;
function colId(doc: Y.Doc, ref: string) {
  const v = view(doc);
  const i = v.refs.indexOf(ref);
  if (i < 0) throw new Error(`no column ${ref}`);
  return v.cols[i]!;
}
function cell(doc: Y.Doc, row: number, ref: string) {
  const p = partsOf(sheetsOf(doc).get(sheetIds(doc)[0]!)!);
  return p.rowData.get(rowId(doc, row))?.get(colId(doc, ref)) ?? "";
}
const set = (doc: Y.Doc, row: string, col: string, value: string) => writeCells(S(doc), [{ rowId: row, colId: col, value }]);

describe("deterministic seed", () => {
  test("two clients seeding the same text produce identical bytes and merge to one copy", () => {
    expect(buildYcsvSeed(SEED)).toEqual(buildYcsvSeed(SEED));
    const a = seeded(SEED, 1);
    const b = seeded(SEED, 2);
    sync(a, b);
    expect(view(a).rows.length).toBe(4);
    expect(sheetIds(a).length).toBe(1);
    expect(readYcsv(a)).toBe(readYcsv(b));
  });

  test("a different salt builds new ids (an outside-write rebuild)", () => {
    const a = new Y.Doc();
    seedYcsv(a, SEED, { origin: "seed", salt: "etag-2" });
    expect(rowId(a, 0)).not.toBe(rowId(seeded(), 0));
  });

  test("read is canonical: seed(read(x)) reads back byte-identical", () => {
    const once = readYcsv(seeded());
    expect(readYcsv(seeded(once))).toBe(once);
  });

  test("emptiness and recognition never create a root", () => {
    const blank = new Y.Doc();
    expect(isYcsvEmpty(blank)).toBe(true);
    expect(recognisesYcsv(blank)).toBe(false);
    expect(blank.share.size).toBe(0);
    const empty = new Y.Doc();
    seedYcsv(empty, "", { origin: "seed" });
    expect(isYcsvEmpty(empty)).toBe(true);
    expect(readYcsv(empty)).toBe("");
  });

  test("text the parser refuses is kept as one text column", () => {
    const doc = seeded("just,some\nlines without frontmatter\n");
    expect(readYcsv(doc)).toContain("lines without frontmatter");
  });
});

describe("per-user undo (one manager per workbook)", () => {
  test("undo reverts only my own edit, never a peer's", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    const undoA = createSheetUndoManager(a);
    set(a, rowId(a, 0), colId(a, "product"), "Peren");
    set(b, rowId(b, 1), colId(b, "product"), "Rogge");
    sync(a, b);
    undoA.undo();
    sync(a, b);
    for (const doc of [a, b]) {
      expect(cell(doc, 0, "product")).toBe("Appels");
      expect(cell(doc, 1, "product")).toBe("Rogge");
    }
  });

  test("undo of a cell a peer overwrote after me keeps the peer's value", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    const undoA = createSheetUndoManager(a);
    set(a, rowId(a, 0), colId(a, "aantal"), "7");
    sync(a, b);
    set(b, rowId(b, 0), colId(b, "aantal"), "9");
    sync(a, b);
    undoA.undo();
    sync(a, b);
    expect(cell(a, 0, "aantal")).toBe("9");
    expect(cell(b, 0, "aantal")).toBe("9");
  });

  test("remote, seed and server updates are not on my undo stack", () => {
    const a = new Y.Doc();
    const undo = createSheetUndoManager(a);
    seedYcsv(a, SEED, { origin: "seed" });
    const b = new Y.Doc();
    sync(a, b);
    set(b, rowId(b, 0), colId(b, "product"), "Peren");
    sync(a, b);
    expect(undo.undoStack.length).toBe(0);
  });

  test("the scope covers sheets created after the manager (multi-sheet)", () => {
    const a = seeded(SEED, 1);
    const undo = createSheetUndoManager(a);
    const id = addSheet(a, { ref: "extra" });
    const p = partsOf(sheetsOf(a).get(id)!);
    writeCells({ doc: a, id }, [{ rowId: p.rowOrder.get(0), colId: p.colOrder.get(0), value: "x" }]);
    undo.undo();
    expect(p.rowData.get(p.rowOrder.get(0))?.get(p.colOrder.get(0))).toBeUndefined();
    undo.undo();
    expect(sheetIds(a).length).toBe(1);
  });

  test("undoing my row insert also removes a peer's edit inside that row (documented)", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    const undoA = createSheetUndoManager(a);
    insertRows(S(a), 4, 1);
    sync(a, b);
    set(b, rowId(b, 4), colId(b, "product"), "Bier");
    sync(a, b);
    undoA.undo();
    sync(a, b);
    expect(view(a).rows.length).toBe(4);
    expect(readYcsv(a)).not.toContain("Bier");
  });

  test("guardedUndo drops my move when a peer moved the same row since (spike 9)", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    const undoA = createSheetUndoManager(a);
    const r0 = rowId(a, 0);
    moveRows(S(a), 0, 1, 4);
    sync(a, b);
    moveRows(S(b), 3, 1, 2);
    sync(a, b);
    expect(guardedUndo(a, undoA)).toBe("dropped");
    sync(a, b);
    expect(view(a).rows.indexOf(r0)).toBe(2);
    expect(readYcsv(a)).toBe(readYcsv(b));
  });
});

describe("conflicts", () => {
  test("same cell, concurrent: both converge on one value (LWW by Yjs client order)", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    set(a, rowId(a, 0), colId(a, "prijs"), "0.50");
    set(b, rowId(b, 0), colId(b, "prijs"), "0.55");
    sync(a, b);
    expect(cell(a, 0, "prijs")).toBe(cell(b, 0, "prijs"));
    expect(["0.50", "0.55"]).toContain(cell(a, 0, "prijs"));
    expect(readYcsv(a)).toBe(readYcsv(b));
  });

  test("delete row while the other edits a cell in it: the row stays deleted, the edit is lost", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    const r1 = rowId(a, 1);
    deleteRows(S(a), [1]);
    set(b, r1, colId(b, "aantal"), "99");
    sync(a, b);
    expect(view(a).rows.length).toBe(3);
    expect(readYcsv(a)).toBe(readYcsv(b));
    expect(readYcsv(a)).not.toContain(",99,");
  });

  test("move a row while the other edits it: the edit follows the row", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    const r0 = rowId(a, 0);
    moveRows(S(a), 0, 1, 4);
    set(b, r0, colId(b, "aantal"), "42");
    sync(a, b);
    expect(view(a).rows.at(-1)).toBe(r0);
    expect(cell(a, 3, "aantal")).toBe("42");
    expect(readYcsv(a)).toBe(readYcsv(b));
  });

  test("insert column + concurrent range formula + row insert inside the range", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    const c = peer(a, 3);
    insertColumns(S(a), 3, 1);
    set(b, rowId(b, 0), colId(b, "product"), `=SUM(totaal@${rowId(b, 0)}:totaal@${rowId(b, 3)})`);
    const [added] = insertRows(S(c), 2, 1);
    set(c, added!, colId(c, "totaal"), "100");
    sync(a, b, c);
    sync(a, b, c);
    expect(readYcsv(a)).toBe(readYcsv(b));
    expect(readYcsv(a)).toBe(readYcsv(c));
    expect(readYcsv(a)).toContain("=SUM(totaal1:totaal5)");
    const engine = new WorkbookEngine(a);
    const sum = engine.value(sheetIds(a)[0]!, "product", rowId(a, 0));
    expect(typeof sum).toBe("number");
    expect(sum as number).toBeGreaterThan(100);
    expect(view(a).cols.length).toBe(5);
    engine.destroy();
  });

  test("two people add a column at once: both exist with distinct ids (refs may collide, documented)", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    insertColumns(S(a), 4, 1);
    insertColumns(S(b), 4, 1);
    sync(a, b);
    expect(view(a).cols.length).toBe(6);
    expect(new Set(view(a).cols).size).toBe(6);
    expect(readYcsv(a)).toBe(readYcsv(b));
  });

  test("delete a column a peer's new formula names: the formula keeps the name and errors", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    deleteColumns(S(a), [view(a).refs.indexOf("prijs")]);
    set(b, rowId(b, 0), colId(b, "totaal"), "=aantal*prijs");
    sync(a, b);
    expect(readYcsv(a)).toBe(readYcsv(b));
    const engine = new WorkbookEngine(a);
    expect(String(engine.value(sheetIds(a)[0]!, "totaal", rowId(a, 0)))).toMatch(/^#/);
    engine.destroy();
  });

  test("concurrent row inserts on two sheets plus a cross-sheet formula converge, repair finds nothing", () => {
    const a = seeded(SEED, 1);
    const id2 = addSheet(a, { ref: "lijst", cols: 2, rows: 3 });
    const b = peer(a, 2);
    const p2 = partsOf(sheetsOf(a).get(id2)!);
    writeCells({ doc: a, id: id2 }, [{ rowId: p2.rowOrder.get(0), colId: p2.colOrder.get(0), value: "5" }]);
    set(b, rowId(b, 0), colId(b, "product"), `=${id2}!a@${p2.rowOrder.get(0)}*2`);
    insertRows({ doc: b, id: id2 }, 0, 1);
    sync(a, b);
    expect(readYcsv(a)).toBe(readYcsv(b));
    expect(readYcsv(a)).toContain("=lijst!a2*2");
    const engine = new WorkbookEngine(a);
    expect(engine.value(sheetIds(a)[0]!, "product", rowId(a, 0))).toBe(10);
    engine.destroy();
    expect(repairWorkbook(a)).toBe(0);
  });
});

describe("presence on stable ids (with sheet id)", () => {
  test("a peer's range follows its rows when someone inserts above, and drops when a row goes", () => {
    const a = seeded(SEED, 1);
    const b = peer(a, 2);
    const awA = new Awareness(a);
    const awB = new Awareness(b);
    awA.setLocalStateField("user", { name: "Ann", color: "#e91e63" });
    const sheetId = sheetIds(a)[0]!;
    setLocalSheetPresence(awA, {
      sheetId,
      active: { rowId: rowId(a, 2), colId: colId(a, "prijs") },
      ranges: [{ anchor: { rowId: rowId(a, 1), colId: colId(a, "aantal") }, head: { rowId: rowId(a, 2), colId: colId(a, "prijs") } }],
      editing: true,
    });
    awarenessCodec.applyAwarenessUpdate(awB, awarenessCodec.encodeAwarenessUpdate(awA, [awA.clientID]), "remote");
    const [p] = readPeerSheetPresence(awB);
    expect(p?.name).toBe("Ann");
    expect(p?.editing).toBe(true);
    expect(p?.sheetId).toBe(sheetId);
    const resolve = () => {
      const v = view(b);
      const r = p!.ranges[0]!;
      const rows = [v.rows.indexOf(r.anchor.rowId), v.rows.indexOf(r.head.rowId)];
      const cols = [v.cols.indexOf(r.anchor.colId), v.cols.indexOf(r.head.colId)];
      if ([...rows, ...cols].some((i) => i < 0)) return null;
      return { top: Math.min(...rows), bottom: Math.max(...rows), left: Math.min(...cols), right: Math.max(...cols) };
    };
    expect(resolve()).toEqual({ top: 1, bottom: 2, left: 1, right: 2 });
    insertRows(S(b), 0, 1);
    expect(resolve()).toEqual({ top: 2, bottom: 3, left: 1, right: 2 });
    deleteRows(S(b), [3]);
    expect(resolve()).toBeNull();
    awA.destroy();
    awB.destroy();
  });
});

describe("canonical save at size", () => {
  test.each([1_000, 10_000, 50_000])("%i rows: serialize cost, file and sidecar size", (rows) => {
    const text = serialize(buildLargeFile(rows));
    const t0 = performance.now();
    const doc = seeded(text);
    const t1 = performance.now();
    const out = readYcsv(doc);
    const t2 = performance.now();
    const ids = view(doc).rows;
    const col = colId(doc, "aantal");
    for (let i = 0; i < 200; i += 1) set(doc, ids[i % rows]!, col, String(i));
    const state = Y.encodeStateAsUpdate(doc);
    const t3 = performance.now();
    readYcsv(doc);
    const t4 = performance.now();
    const fileBytes = new TextEncoder().encode(out).byteLength;
    console.log(
      JSON.stringify({
        rows,
        seedMs: Math.round(t1 - t0),
        serializeMs: Math.round(t2 - t1),
        serializeAfterEditsMs: Math.round(t4 - t3),
        fileKiB: Math.round(fileBytes / 1024),
        yjsKiB: Math.round(state.byteLength / 1024),
      }),
    );
    expect(readYcsv(seeded(out))).toBe(out);
  }, 120_000);
});
