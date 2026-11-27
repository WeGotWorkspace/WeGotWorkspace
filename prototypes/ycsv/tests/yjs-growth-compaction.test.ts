import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { orderArrayLayout as L } from "../src/ycsv-layout";
import { applyDocOp, canon, docsShape, seedDocs, snapshotDocs } from "../src/yjs-growth/docs-raw";
import { EpochServer, compact, docFrom, epochOf, GENESIS, rebase } from "../src/yjs-growth/epoch";
import { mulberry32 } from "../src/yjs-growth/rng";
import { seedSheet } from "../src/yjs-growth/sheet-sim";
import { sheetShape, snapshotSheet } from "../src/yjs-growth/sheet-shape";

const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

function sheetDoc(seed = 1, rows = 20, cols = 4): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = 1;
  const f = seedSheet(mulberry32(seed), rows, cols);
  L.seed(doc, f.cols, f.rows, "seed");
  return doc;
}

describe("spike 10: compaction by epoch", () => {
  it("is deterministic: two clients compacting the same state produce the same epoch and bytes", () => {
    const doc = sheetDoc();
    for (let i = 0; i < 50; i += 1) L.setCell(doc, L.rowOrder(doc)[i % 20] as string, L.colOrder(doc)[i % 4] as string, `v${i}`);
    const copy = docFrom(Y.encodeStateAsUpdate(doc));
    const a = compact(sheetShape, doc);
    const b = compact(sheetShape, copy);
    expect(a.epoch).toBe(b.epoch);
    expect(Buffer.from(a.update).equals(Buffer.from(b.update))).toBe(true);
    expect(epochOf(a.doc)).toBe(a.epoch);
    expect(a.parent).toBe(GENESIS);
  });

  it("keeps the content, ids and file text, and drops the history", () => {
    const doc = sheetDoc(2, 50, 5);
    const rows = L.rowOrder(doc);
    for (let i = 0; i < 2000; i += 1) L.setCell(doc, rows[i % 50] as string, L.colOrder(doc)[i % 5] as string, `value ${i}`);
    L.sortRows(doc, L.colOrder(doc)[1] as string);
    const c = compact(sheetShape, doc);
    expect(snapshotSheet(c.doc)).toEqual(snapshotSheet(doc));
    expect(sheetShape.text(c.doc)).toBe(sheetShape.text(doc));
    // One client overwriting 2,000 times: the tombstones are small (the old values are collected).
    expect(c.update.byteLength).toBeLessThan(Y.encodeStateAsUpdate(doc).byteLength);
  });

  it("Docs: keeps blocks, marks, comment anchors and threads", () => {
    const doc = new Y.Doc();
    seedDocs(doc, [
      { type: "heading", text: "Plan" },
      { type: "paragraph", text: "Eerste alinea met tekst." },
    ]);
    applyDocOp(doc, { k: "format", block: 1, from: 0, to: 6, mark: "bold", value: {} });
    applyDocOp(doc, { k: "format", block: 1, from: 7, to: 14, mark: "comment", value: { id: "c1" } });
    applyDocOp(doc, { k: "thread", id: "c1", value: { id: "c1", createdAt: "x", author: "a", resolved: false, messages: [] } });
    for (let i = 0; i < 200; i += 1) {
      applyDocOp(doc, { k: "insert", block: 1, offset: 0, text: "x" });
      applyDocOp(doc, { k: "delete", block: 1, offset: 0, len: 1 });
    }
    const c = compact(docsShape, doc);
    expect(canon(snapshotDocs(c.doc))).toBe(canon(snapshotDocs(doc)));
    expect(docsShape.text(c.doc)).toBe(docsShape.text(doc));
  });

  it("two epochs must never meet: merging a compacted state into an old replica shows everything twice", () => {
    const doc = sheetDoc(3, 10, 3);
    const c = compact(sheetShape, doc);
    const mixed = docFrom(Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(mixed, c.update);
    // Row ids are the same, so the order array lists every row twice and the
    // read rule hides it; Docs has no ids and shows the text twice (next test).
    expect(mixed.getArray("rowOrder").length).toBe(20);
    const d = new Y.Doc();
    seedDocs(d, [{ type: "paragraph", text: "Een" }]);
    const dc = compact(docsShape, d);
    Y.applyUpdate(d, dc.update);
    expect(d.getXmlFragment("default").length).toBe(2);
  });

  it("the server refuses a save from an old epoch", () => {
    const doc = sheetDoc();
    const server = new EpochServer(Y.encodeStateAsUpdate(doc));
    const c = compact(sheetShape, docFrom(server.sidecar));
    expect(server.compact(GENESIS, server.sidecar, c)).toBe("ok");
    expect(server.save(GENESIS, Y.encodeStateAsUpdate(doc))).toBe("epoch_changed");
    expect(server.save(c.epoch, c.update)).toBe("ok");
    // A second compactor that read the old sidecar loses the race.
    expect(server.compact(GENESIS, server.archive.get(GENESIS) as Uint8Array, c)).toBe("conflict");
  });

  it("an offline Sheets peer rebases onto the new epoch without losing its edits or the others'", () => {
    const start = sheetDoc(4, 12, 4);
    const server = new EpochServer(Y.encodeStateAsUpdate(start));
    const online = docFrom(server.sidecar, 10);
    const offline = docFrom(server.sidecar, 20);
    const rows = L.rowOrder(start);
    const cols = L.colOrder(start);
    // Offline: edit a cell, insert a row, move one, delete one.
    L.setCell(offline, rows[0] as string, cols[0] as string, "offline-edit");
    L.insertRow(offline, "r_new_offline", rows[3] as string);
    L.setCell(offline, "r_new_offline", cols[1] as string, "offline-row");
    L.moveRows(offline, [rows[5] as string], rows[1] as string);
    L.deleteRow(offline, rows[11] as string);
    // Online: edits, saved, then compacted; more edits in the new epoch.
    L.setCell(online, rows[2] as string, cols[2] as string, "online-before");
    expect(server.save(GENESIS, Y.encodeStateAsUpdate(online))).toBe("ok");
    const c = compact(sheetShape, docFrom(server.sidecar));
    expect(server.compact(GENESIS, server.sidecar, c)).toBe("ok");
    const after = docFrom(server.sidecar, 11);
    L.setCell(after, rows[0] as string, cols[3] as string, "online-after");
    L.insertRow(after, "r_new_online", null);
    expect(server.save(c.epoch, Y.encodeStateAsUpdate(after))).toBe("ok");
    // The offline peer comes back: its save is refused, it rebases.
    expect(server.save(GENESIS, Y.encodeStateAsUpdate(offline))).toBe("epoch_changed");
    const r = rebase(sheetShape, offline, server.archive.get(GENESIS) as Uint8Array, server.sidecar, 21);
    expect(r.replayed).toBe(true);
    expect(server.save(c.epoch, Y.encodeStateAsUpdate(r.doc))).toBe("ok");
    sync(after, r.doc);
    const s = snapshotSheet(r.doc);
    expect(snapshotSheet(after)).toEqual(s);
    const byId = new Map(s.rows.map((row) => [row.id, row.cells]));
    expect(byId.get(rows[0] as string)?.[cols[0] as string]).toBe("offline-edit");
    expect(byId.get(rows[0] as string)?.[cols[3] as string]).toBe("online-after");
    expect(byId.get(rows[2] as string)?.[cols[2] as string]).toBe("online-before");
    expect(byId.get("r_new_offline")?.[cols[1] as string]).toBe("offline-row");
    expect(byId.has("r_new_online")).toBe(true);
    expect(byId.has(rows[11] as string)).toBe(false);
    const order = s.rows.map((row) => row.id);
    expect(order.indexOf(rows[5] as string)).toBe(order.indexOf(rows[1] as string) - 1);
    expect(order.indexOf("r_new_offline")).toBe(order.indexOf(rows[3] as string) - 1);
  });

  it("an offline Docs peer rebases: its typing lands in the same paragraph as concurrent typing", () => {
    const start = new Y.Doc();
    start.clientID = 1;
    seedDocs(start, [
      { type: "heading", text: "Titel" },
      { type: "paragraph", text: "Alpha beta gamma." },
      { type: "paragraph", text: "Delta." },
    ]);
    const server = new EpochServer(Y.encodeStateAsUpdate(start));
    const offline = docFrom(server.sidecar, 20);
    applyDocOp(offline, { k: "insert", block: 1, offset: 5, text: " OFFLINE" });
    applyDocOp(offline, { k: "newBlock", at: 1, type: "paragraph", text: "Nieuwe alinea offline." });
    applyDocOp(offline, { k: "format", block: 3, from: 0, to: 5, mark: "bold", value: {} });
    const c = compact(docsShape, docFrom(server.sidecar));
    server.compact(GENESIS, server.sidecar, c);
    const online = docFrom(server.sidecar, 11);
    applyDocOp(online, { k: "insert", block: 1, offset: 17, text: " ONLINE" });
    server.save(c.epoch, Y.encodeStateAsUpdate(online));
    const r = rebase(docsShape, offline, server.archive.get(GENESIS) as Uint8Array, server.sidecar, 21);
    sync(online, r.doc);
    expect(docsShape.text(r.doc)).toBe(docsShape.text(online));
    expect(docsShape.text(r.doc)).toBe("## Titel\n\nNieuwe alinea offline.\n\nAlpha OFFLINE beta gamma. ONLINE\n\n**Delta**.\n");
  });

  it("an offline peer whose only edits are deletions keeps them (deleting does not move the state vector)", () => {
    const start = new Y.Doc();
    start.clientID = 1;
    seedDocs(start, [{ type: "paragraph", text: "keep drop keep" }]);
    const server = new EpochServer(Y.encodeStateAsUpdate(start));
    const offline = docFrom(server.sidecar, 20);
    applyDocOp(offline, { k: "delete", block: 0, offset: 4, len: 5 });
    expect(Y.encodeStateVector(offline)).toEqual(Y.encodeStateVector(docFrom(server.sidecar)));
    const c = compact(docsShape, docFrom(server.sidecar));
    server.compact(GENESIS, server.sidecar, c);
    const r = rebase(docsShape, offline, server.archive.get(GENESIS) as Uint8Array, server.sidecar, 21);
    expect(r.replayed).toBe(true);
    expect(docsShape.text(r.doc)).toBe("keep keep\n");
  });

  it("a peer without unsaved edits just takes the new epoch", () => {
    const doc = sheetDoc();
    const server = new EpochServer(Y.encodeStateAsUpdate(doc));
    const peer = docFrom(server.sidecar, 5);
    const c = compact(sheetShape, docFrom(server.sidecar));
    server.compact(GENESIS, server.sidecar, c);
    const r = rebase(sheetShape, peer, server.archive.get(GENESIS) as Uint8Array, server.sidecar, 6);
    expect(r.replayed).toBe(false);
    expect(epochOf(r.doc)).toBe(c.epoch);
  });
});
