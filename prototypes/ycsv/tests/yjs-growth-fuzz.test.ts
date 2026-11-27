import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { orderArrayLayout as L } from "../src/ycsv-layout";
import { applyDocOp, blockText, docsShape, docsShapeContentDiff, seedDocs } from "../src/yjs-growth/docs-raw";
import { type CompactableShape, EpochServer, compact, docFrom, epochOf, rebase } from "../src/yjs-growth/epoch";
import { type Rng, chance, int, mulberry32, pick } from "../src/yjs-growth/rng";
import { sheetShape, snapshotSheet } from "../src/yjs-growth/sheet-shape";

/**
 * Spike 10 fuzz: "an offline peer + compaction loses nothing".
 *
 * Four peers edit at random. Peers go offline for many steps and come back;
 * online peers save after each step with today's model (read the sidecar,
 * merge, PUT the whole state). Now and then an online peer compacts the
 * server's state into a new epoch; there can be several compactions while a
 * peer is away. A peer that finds a newer epoch rebases through every epoch it
 * missed (the server keeps the archived final state of each).
 *
 * Every value written is unique, so it can be traced. At the end all peers and
 * the server must show the same content, nothing written may be lost unless
 * someone deleted its row/column/token, and nothing deleted may come back.
 */
const RUNS = Number(process.env.FUZZ_RUNS ?? 150);
const STEPS = 120;
const COMPACT_P = Number(process.env.FUZZ_COMPACT_P ?? 0.06);

type Harness<S> = {
  shape: CompactableShape<unknown>;
  initial(rng: Rng): Y.Doc;
  act(doc: Y.Doc, rng: Rng, peer: number, step: number, track: S): void;
  track(): S;
  check(final: Y.Doc, track: S): string[];
};

class Network {
  readonly server: EpochServer;
  readonly children = new Map<string, string>();
  rebases = 0;
  replays = 0;
  compactions = 0;
  constructor(initial: Y.Doc) {
    this.server = new EpochServer(Y.encodeStateAsUpdate(initial));
  }
  /** The state a replica in `epoch` should rebase onto: the next epoch's final (or current) state. */
  next(epoch: string): { child: string; state: Uint8Array } {
    const child = this.children.get(epoch) as string;
    const state = child === this.server.epoch ? this.server.sidecar : (this.server.archive.get(child) as Uint8Array);
    return { child, state };
  }
}

function catchUp(net: Network, shape: CompactableShape<unknown>, doc: Y.Doc, clientID: () => number): Y.Doc {
  let current = doc;
  while (epochOf(current) !== net.server.epoch) {
    const { state } = net.next(epochOf(current));
    const r = rebase(shape, current, net.server.archive.get(epochOf(current)) as Uint8Array, state, clientID());
    net.rebases += 1;
    if (r.replayed) net.replays += 1;
    current = r.doc;
  }
  return current;
}

/** Today's save: merge the server state in, PUT the whole state (always in the server's epoch here). */
function save(net: Network, doc: Y.Doc): void {
  Y.applyUpdate(doc, net.server.sidecar, "server");
  expect(net.server.save(epochOf(doc), Y.encodeStateAsUpdate(doc))).toBe("ok");
}

function runFuzz<S>(h: Harness<S>, seed: number) {
  const rng = mulberry32(seed);
  const initial = h.initial(rng);
  const net = new Network(initial);
  const track = h.track();
  let nextClient = 100;
  const clientID = () => (nextClient += 1);
  let docs = Array.from({ length: 4 }, () => docFrom(net.server.sidecar, clientID()));
  const offlineUntil = [0, 0, 0, 0];
  for (let step = 0; step < STEPS; step += 1) {
    const p = int(rng, 0, 3);
    const online = step >= (offlineUntil[p] as number);
    if (online && chance(rng, 0.08)) offlineUntil[p] = step + int(rng, 10, 60);
    if (online) docs[p] = catchUp(net, h.shape, docs[p] as Y.Doc, clientID);
    for (let i = int(rng, 1, 4); i > 0; i -= 1) h.act(docs[p] as Y.Doc, rng, p, step, track);
    if (step < (offlineUntil[p] as number)) continue;
    save(net, docs[p] as Y.Doc);
    if (chance(rng, COMPACT_P)) {
      const from = net.server.epoch;
      const c = compact(h.shape, docFrom(net.server.sidecar));
      expect(net.server.compact(from, net.server.sidecar, c)).toBe("ok");
      net.children.set(from, c.epoch);
      net.compactions += 1;
      // The compactor moves over at once (it had just saved).
      docs[p] = docFrom(c.update, clientID());
    }
  }
  // Everyone comes back, catches up and saves; then a last read.
  for (let round = 0; round < 2; round += 1) {
    docs = docs.map((doc) => {
      const d = catchUp(net, h.shape, doc, clientID);
      save(net, d);
      return d;
    });
  }
  docs = docs.map((doc) => {
    Y.applyUpdate(doc, net.server.sidecar);
    return doc;
  });
  const server = docFrom(net.server.sidecar);
  const contents = docs.map((d) => JSON.stringify(h.shape.snapshot(d)));
  const diverged = contents.some((c) => c !== JSON.stringify(h.shape.snapshot(server)));
  return { diverged, problems: h.check(server, track), net };
}

// --- Sheets ------------------------------------------------------------------

type SheetTrack = { writes: Map<string, string[]>; deletedRows: Set<string>; deletedCols: Set<string>; insertedRows: Set<string>; seedRows: string[]; n: number };

const sheetHarness: Harness<SheetTrack> = {
  shape: sheetShape as CompactableShape<unknown>,
  initial() {
    const doc = new Y.Doc();
    doc.clientID = 1;
    const cols = ["c0", "c1", "c2", "c3"].map((id, i) => ({ id, ref: `k${i}` }));
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, cells: { c0: `s${i}` } }));
    L.seed(doc, cols, rows, "seed");
    return doc;
  },
  track: () => ({ writes: new Map(), deletedRows: new Set(), deletedCols: new Set(), insertedRows: new Set(), seedRows: Array.from({ length: 10 }, (_, i) => `r${i}`), n: 0 }),
  act(doc, rng, peer, _step, t) {
    const rows = L.rowOrder(doc);
    const cols = L.colOrder(doc);
    if (rows.length === 0 || cols.length === 0) return;
    const op = rng();
    if (op < 0.6) {
      const r = pick(rng, rows);
      const c = pick(rng, cols);
      const v = `p${peer}w${(t.n += 1)}`;
      L.setCell(doc, r, c, v);
      const key = `${r}|${c}`;
      t.writes.set(key, [...(t.writes.get(key) ?? []), v]);
    } else if (op < 0.72) {
      const id = `n${peer}_${(t.n += 1)}`;
      L.insertRow(doc, id, chance(rng, 0.5) ? null : pick(rng, rows));
      t.insertedRows.add(id);
    } else if (op < 0.78 && rows.length > 3) {
      const r = pick(rng, rows);
      L.deleteRow(doc, r);
      t.deletedRows.add(r);
    } else if (op < 0.9) {
      L.moveRows(doc, [pick(rng, rows)], chance(rng, 0.2) ? null : pick(rng, rows));
    } else if (op < 0.94) {
      L.sortRows(doc, pick(rng, cols), chance(rng, 0.5));
    } else if (op < 0.97) {
      L.renameCol(doc, pick(rng, cols), `k_${peer}_${(t.n += 1)}`);
    } else if (op < 0.985) {
      L.insertCol(doc, `cx${peer}_${(t.n += 1)}`, `kx${t.n}`, chance(rng, 0.5) ? null : pick(rng, cols));
    } else if (cols.length > 2) {
      const c = pick(rng, cols);
      L.deleteCol(doc, c);
      t.deletedCols.add(c);
    }
  },
  check(final, t) {
    const problems: string[] = [];
    const s = snapshotSheet(final);
    const ids = s.rows.map((r) => r.id);
    if (new Set(ids).size !== ids.length) problems.push("duplicate row");
    const byId = new Map(s.rows.map((r) => [r.id, r.cells]));
    for (const r of t.deletedRows) if (byId.has(r)) problems.push(`deleted row ${r} came back`);
    for (const r of [...t.insertedRows, ...t.seedRows]) if (!t.deletedRows.has(r) && !byId.has(r)) problems.push(`row ${r} lost`);
    const liveCols = new Set(s.cols.map((c) => c.id));
    for (const [key, values] of t.writes) {
      const [r, c] = key.split("|") as [string, string];
      if (t.deletedRows.has(r) || t.deletedCols.has(c) || !liveCols.has(c)) continue;
      const value = byId.get(r)?.[c] ?? "";
      if (!values.includes(value)) problems.push(`cell ${key} = "${value}", written ${values.join(",")}`);
      else if (values.length === 1 && value !== values[0]) problems.push(`cell ${key} lost its only write`);
    }
    return problems;
  },
};

// --- Docs --------------------------------------------------------------------

type DocsTrack = { inserted: Set<string>; deleted: Set<string>; threads: Map<string, string[]>; n: number };

/** Positions in a block's text where a token may go: before a space or at the end. */
function boundaries(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i <= text.length; i += 1) if (i === text.length || text[i] === " ") out.push(i);
  return out;
}

const docsHarness: Harness<DocsTrack> = {
  shape: docsShape as CompactableShape<unknown>,
  initial() {
    const doc = new Y.Doc();
    doc.clientID = 1;
    seedDocs(doc, Array.from({ length: 4 }, (_, i) => ({ type: i === 0 ? "heading" : "paragraph", text: ` s${i}a s${i}b` })));
    return doc;
  },
  track: () => ({ inserted: new Set(["s0a", "s0b", "s1a", "s1b", "s2a", "s2b", "s3a", "s3b"]), deleted: new Set(), threads: new Map(), n: 0 }),
  act(doc, rng, peer, _step, t) {
    const frag = doc.getXmlFragment("default");
    const op = rng();
    if (frag.length === 0 || op < 0.08) {
      const tok = `t${peer}x${(t.n += 1)}`;
      applyDocOp(doc, { k: "newBlock", at: int(rng, 0, frag.length), type: chance(rng, 0.2) ? "heading" : "paragraph", text: ` ${tok}` });
      t.inserted.add(tok);
      return;
    }
    const b = int(rng, 0, frag.length - 1);
    const plainText = blockText(doc, b);
    if (op < 0.7) {
      const tok = `t${peer}x${(t.n += 1)}`;
      applyDocOp(doc, { k: "insert", block: b, offset: pick(rng, boundaries(plainText)), text: ` ${tok}`, marks: {} as never });
      t.inserted.add(tok);
    } else if (op < 0.82) {
      const tokens = [...plainText.matchAll(/ ([a-z0-9]+)/g)];
      if (tokens.length === 0) return;
      const m = pick(rng, tokens);
      applyDocOp(doc, { k: "delete", block: b, offset: m.index as number, len: m[0].length });
      t.deleted.add(m[1] as string);
    } else if (op < 0.92) {
      const bs = boundaries(plainText);
      const from = pick(rng, bs);
      const to = pick(rng, bs);
      if (to > from) applyDocOp(doc, { k: "format", block: b, from, to, mark: pick(rng, ["bold", "italic"] as const), value: chance(rng, 0.3) ? null : {} });
    } else {
      const id = `th${int(rng, 0, 5)}`;
      const body = `p${peer}m${(t.n += 1)}`;
      applyDocOp(doc, { k: "thread", id, value: { id, createdAt: "x", author: `p${peer}`, resolved: false, messages: [{ id: body, author: `p${peer}`, body, createdAt: "x" }] } });
      t.threads.set(id, [...(t.threads.get(id) ?? []), body]);
    }
  },
  check(final, t) {
    const problems: string[] = [];
    const text = docsShape.text(final).replace(/\*/g, "");
    const counts = new Map<string, number>();
    for (const m of text.matchAll(/(?:^|[\s#])([st]\d+[a-z]\d*[a-z]?\d*)/g)) counts.set(m[1] as string, (counts.get(m[1] as string) ?? 0) + 1);
    for (const tok of t.inserted) {
      const n = counts.get(tok) ?? 0;
      if (t.deleted.has(tok)) {
        if (n > 0) problems.push(`deleted ${tok} came back (${n}×)`);
      } else if (n !== 1) problems.push(`${tok} present ${n}×`);
    }
    const threads = final.getMap<{ messages: { body: string }[] }>("comments");
    for (const [id, bodies] of t.threads) {
      const v = threads.get(id);
      if (!v || !bodies.includes(v.messages[0]?.body as string)) problems.push(`thread ${id} lost`);
    }
    return problems;
  },
};

describe("spike 10 fuzz: the content-diff replay (rejected) for comparison", () => {
  it("docs, replay by content diff: counts problems, does not assert", () => {
    let problems = 0;
    let runsWithProblems = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const r = runFuzz({ ...docsHarness, shape: docsShapeContentDiff } as Harness<unknown>, 1000 + run);
      problems += r.problems.length + (r.diverged ? 1 : 0);
      if (r.problems.length > 0 || r.diverged) runsWithProblems += 1;
    }
    console.log(`docs content-diff replay: ${RUNS} runs, ${runsWithProblems} runs with problems, ${problems} problems`);
  }, 600_000);
});

describe("spike 10 fuzz: offline peers + compaction lose nothing", () => {
  for (const [name, harness] of [
    ["sheets (order-array layout)", sheetHarness],
    ["docs (raw y-prosemirror shape)", docsHarness],
  ] as const) {
    it(`${name}: ${RUNS} runs`, () => {
      let compactions = 0;
      let rebases = 0;
      let replays = 0;
      const failures: string[] = [];
      const only = process.env.FUZZ_ONLY ? Number(process.env.FUZZ_ONLY) : null;
      for (let run = 0; run < RUNS; run += 1) {
        if (only !== null && run !== only) continue;
        const r = runFuzz(harness as Harness<unknown>, 1000 + run);
        compactions += r.net.compactions;
        rebases += r.net.rebases;
        replays += r.net.replays;
        if (r.diverged) failures.push(`run ${run}: diverged`);
        for (const p of r.problems) failures.push(`run ${run}: ${p}`);
      }
      console.log(`${name}: ${RUNS} runs, ${compactions} compactions, ${rebases} rebases (${replays} with offline edits replayed), ${failures.length} problems`);
      expect(failures.slice(0, 20)).toEqual([]);
      expect(replays).toBeGreaterThan(RUNS / 2);
    }, 600_000);
  }
});
