/**
 * Spike 5: semantics Docs does not have — deterministic seed, per-user undo,
 * conflicts, presence on stable ids, and the canonical save at size.
 * Pure Yjs, no transport: `sync()` exchanges state diffs like a reconnect.
 */
import { Awareness } from "y-protocols/awareness";
import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { SEED } from "../src/stories/fixtures";
import { serialize } from "../src/ycsv-core/serialize";
import { buildLargeFile } from "../src/stories/large-sheet";
import { evaluateAll, type RawCells } from "../src/ycsv-formula";
import {
  buildYcsvSeed,
  createSheetUndoManager,
  isYcsvEmpty,
  readPeerSheetPresence,
  readYcsv,
  recognisesYcsv,
  resolveRange,
  seedYcsv,
  setLocalSheetPresence,
} from "../src/ycsv-collab";
import { deleteColumn, deleteRow, insertColumn, insertRowAfter, setCell } from "../src/ycsv-model";

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

function colId(doc: Y.Doc, ref: string) {
  const columns = doc.getArray<Y.Map<unknown>>("columns");
  for (let i = 0; i < columns.length; i += 1) {
    if (columns.get(i).get("ref") === ref) return String(columns.get(i).get("colId"));
  }
  throw new Error(`no column ${ref}`);
}

const rowId = (doc: Y.Doc, index: number) =>
  String(doc.getArray<Y.Map<unknown>>("rows").get(index).get("rowId"));

function cell(doc: Y.Doc, row: number, ref: string) {
  const cells = doc.getArray<Y.Map<unknown>>("rows").get(row).get("cells") as Y.Map<string>;
  return cells.get(colId(doc, ref)) ?? "";
}

function values(doc: Y.Doc) {
  const columns = doc.getArray<Y.Map<unknown>>("columns");
  const rows = doc.getArray<Y.Map<unknown>>("rows");
  const cols: { colId: string; ref: string }[] = [];
  for (let i = 0; i < columns.length; i += 1) {
    cols.push({ colId: String(columns.get(i).get("colId")), ref: String(columns.get(i).get("ref")) });
  }
  const raw: RawCells = new Map();
  const order: string[] = [];
  for (let r = 0; r < rows.length; r += 1) {
    const id = String(rows.get(r).get("rowId"));
    order.push(id);
    const cells = rows.get(r).get("cells") as Y.Map<string>;
    for (const c of cols) raw.set(`${c.ref}@${id}`, cells.get(c.colId) ?? "");
  }
  const defs = doc.getMap("raw").get("defs") as Record<string, unknown> | undefined;
  return { v: evaluateAll(raw, order, defs ?? {}, cols.map((c) => c.ref)), order };
}

describe("deterministic seed", () => {
  test("two clients seeding the same text produce identical bytes and merge to one copy", () => {
    expect(buildYcsvSeed(SEED)).toEqual(buildYcsvSeed(SEED));
    const a = seeded(SEED, 1);
    const b = seeded(SEED, 2);
    sync(a, b);
    expect(a.getArray("rows").length).toBe(4);
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

describe("per-user undo", () => {
  test("undo reverts only my own edit, never a peer's", () => {
    const a = seeded(SEED, 1);
    const b = new Y.Doc();
    b.clientID = 2;
    sync(a, b);
    const undoA = createSheetUndoManager(a, 0);
    setCell(a, rowId(a, 0), colId(a, "product"), "Peren");
    setCell(b, rowId(b, 1), colId(b, "product"), "Rogge");
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
    const b = new Y.Doc();
    b.clientID = 2;
    sync(a, b);
    const undoA = createSheetUndoManager(a, 0);
    setCell(a, rowId(a, 0), colId(a, "aantal"), "7");
    sync(a, b);
    setCell(b, rowId(b, 0), colId(b, "aantal"), "9");
    sync(a, b);
    undoA.undo();
    sync(a, b);
    expect(cell(a, 0, "aantal")).toBe("9");
    expect(cell(b, 0, "aantal")).toBe("9");
  });

  test("remote, seed and server updates are not on my undo stack", () => {
    const a = new Y.Doc();
    const undo = createSheetUndoManager(a, 0);
    seedYcsv(a, SEED, { origin: "seed" });
    const b = new Y.Doc();
    sync(a, b);
    setCell(b, rowId(b, 0), colId(b, "product"), "Peren");
    sync(a, b);
    expect(undo.undoStack.length).toBe(0);
  });

  test("undoing my row insert also removes a peer's edit inside that row (documented)", () => {
    const a = seeded(SEED, 1);
    const b = new Y.Doc();
    b.clientID = 2;
    sync(a, b);
    const undoA = createSheetUndoManager(a, 0);
    insertRowAfter(a, 3);
    sync(a, b);
    setCell(b, rowId(b, 4), colId(b, "product"), "Bier");
    sync(a, b);
    undoA.undo();
    sync(a, b);
    expect(a.getArray("rows").length).toBe(4);
    expect(readYcsv(a)).not.toContain("Bier");
  });
});

describe("conflicts", () => {
  test("same cell, concurrent: both converge on one value (LWW by Yjs client order)", () => {
    const a = seeded(SEED, 1);
    const b = new Y.Doc();
    b.clientID = 2;
    sync(a, b);
    setCell(a, rowId(a, 0), colId(a, "prijs"), "0.50");
    setCell(b, rowId(b, 0), colId(b, "prijs"), "0.55");
    sync(a, b);
    expect(cell(a, 0, "prijs")).toBe(cell(b, 0, "prijs"));
    expect(["0.50", "0.55"]).toContain(cell(a, 0, "prijs"));
    expect(readYcsv(a)).toBe(readYcsv(b));
  });

  test("delete row while the other edits a cell in it: the row stays deleted, the edit is lost", () => {
    const a = seeded(SEED, 1);
    const b = new Y.Doc();
    sync(a, b);
    deleteRow(a, rowId(a, 1));
    setCell(b, rowId(b, 1), colId(b, "aantal"), "99");
    sync(a, b);
    expect(a.getArray("rows").length).toBe(3);
    expect(readYcsv(a)).toBe(readYcsv(b));
    expect(readYcsv(a)).not.toContain(",99,");
  });

  test("insert column + concurrent range formula + row insert inside the range", () => {
    const a = seeded(SEED, 1);
    const b = new Y.Doc();
    const c = new Y.Doc();
    sync(a, b, c);
    insertColumn(a, 3, "korting");
    // B sums totaal over rows 1..4, C inserts a row between 2 and 3.
    setCell(b, rowId(b, 0), colId(b, "product"), "=SUM(totaal1:totaal4)");
    insertRowAfter(c, 1);
    setCell(c, rowId(c, 2), colId(c, "totaal"), "100");
    sync(a, b, c);
    sync(a, b, c);
    expect(readYcsv(a)).toBe(readYcsv(b));
    expect(readYcsv(a)).toBe(readYcsv(c));
    // The range follows its end rows: the inserted row is inside, the formula text reflects 5 rows.
    expect(cell(a, 0, "product")).toMatch(/^=SUM\(totaal@r_.+:totaal@r_.+\)$/);
    expect(readYcsv(a)).toContain("=SUM(totaal1:totaal5)");
    const { v } = values(a);
    const sum = v.get(`product@${rowId(a, 0)}`);
    expect(typeof sum).toBe("number");
    expect(sum as number).toBeGreaterThan(100);
    // The column the formula did not name changed nothing.
    expect(a.getArray("columns").length).toBe(5);
  });

  test("two people add a column with the same ref: both columns exist, refs collide (documented)", () => {
    const a = seeded(SEED, 1);
    const b = new Y.Doc();
    sync(a, b);
    insertColumn(a, 4, "notitie");
    insertColumn(b, 4, "notitie");
    sync(a, b);
    const refs = a.getArray<Y.Map<unknown>>("columns").map((col) => col.get("ref"));
    expect(refs.filter((ref) => ref === "notitie").length).toBe(2);
    expect(readYcsv(a)).toBe(readYcsv(b));
  });

  test("delete a column a peer's new formula names: the formula keeps the name and errors", () => {
    const a = seeded(SEED, 1);
    const b = new Y.Doc();
    sync(a, b);
    deleteColumn(a, colId(a, "prijs"));
    setCell(b, rowId(b, 0), colId(b, "totaal"), "=aantal*prijs");
    sync(a, b);
    expect(readYcsv(a)).toBe(readYcsv(b));
    const { v } = values(a);
    expect(String(v.get(`totaal@${rowId(a, 0)}`))).toMatch(/^#/);
  });
});

describe("presence on stable ids", () => {
  test("a peer's range follows its rows when someone inserts above, and drops when a row goes", () => {
    const a = seeded(SEED, 1);
    const b = new Y.Doc();
    sync(a, b);
    const awA = new Awareness(a);
    const awB = new Awareness(b);
    awA.setLocalStateField("user", { name: "Ann", color: "#e91e63" });
    setLocalSheetPresence(awA, {
      active: { rowId: rowId(a, 2), colId: colId(a, "prijs") },
      range: {
        anchor: { rowId: rowId(a, 1), colId: colId(a, "aantal") },
        head: { rowId: rowId(a, 2), colId: colId(a, "prijs") },
      },
      editing: true,
    });
    // Ship A's awareness to B as the transport would.
    const { encodeAwarenessUpdate, applyAwarenessUpdate } = awarenessCodec;
    applyAwarenessUpdate(awB, encodeAwarenessUpdate(awA, [awA.clientID]), "remote");
    const [peer] = readPeerSheetPresence(awB);
    expect(peer?.name).toBe("Ann");
    expect(peer?.editing).toBe(true);
    expect(resolveRange(b, peer!.range!)).toEqual({ top: 1, bottom: 2, left: 1, right: 2 });
    insertRowAfter(b, -1);
    expect(resolveRange(b, peer!.range!)).toEqual({ top: 2, bottom: 3, left: 1, right: 2 });
    deleteRow(b, rowId(b, 2));
    expect(resolveRange(b, peer!.range!)).toBeNull();
    awA.destroy();
    awB.destroy();
  });
});

import * as awarenessCodec from "y-protocols/awareness";

describe("canonical save at size", () => {
  test.each([1_000, 10_000, 50_000])("%i rows: serialize cost, file and sidecar size", (rows) => {
    const text = serialize(buildLargeFile(rows));
    const t0 = performance.now();
    const doc = seeded(text);
    const t1 = performance.now();
    const out = readYcsv(doc);
    const t2 = performance.now();
    // 200 single-cell edits by one person, as a session would add.
    for (let i = 0; i < 200; i += 1) setCell(doc, rowId(doc, i % rows), colId(doc, "aantal"), String(i));
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
        fileUnder2MiB: fileBytes <= 2_097_152,
        yjsUnder5MiB: state.byteLength <= 5_242_880,
      }),
    );
    expect(readYcsv(seeded(out))).toBe(out);
  }, 120_000);
});
