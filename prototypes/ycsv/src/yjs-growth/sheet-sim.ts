import * as Y from "yjs";
import { orderArrayLayout as L } from "../ycsv-layout";
import { type Rng, chance, distinctUsers, int, mulberry32, pick, sessionClientId, weighted, words } from "./rng";
import { type Sizes, type StructStats, sizes, structStats } from "./measure";
import { compact } from "./epoch";
import { sheetShape } from "./sheet-shape";

/**
 * Spike 10: months of ordinary use of one sheet, on spike 9's order-array
 * layout, by several people. Every browser session gets a fresh Yjs client id
 * (that is what a page load does: y-indexeddb loads into a new Y.Doc). Online
 * sessions sync with the server copy every few actions, two people sometimes
 * work at the same time, and one person works offline for days and merges.
 */
export type SheetAction =
  | "retype"
  | "typo-fix"
  | "formula"
  | "insert-row"
  | "delete-row"
  | "move-rows"
  | "sort"
  | "paste-block"
  | "clear-range"
  | "column-op";

/** A sheet that is mostly edited in place: the row count stays roughly level. */
export const SHEET_MIX: readonly (readonly [number, SheetAction])[] = [
  [55, "retype"],
  [10, "typo-fix"],
  [6, "formula"],
  [5, "insert-row"],
  [5, "delete-row"],
  [5, "move-rows"],
  [1, "sort"],
  [5, "paste-block"],
  [7, "clear-range"],
  [1, "column-op"],
];

/** A log or ledger: rows are appended every day and rarely removed. */
export const LOG_MIX: readonly (readonly [number, SheetAction])[] = [
  [40, "retype"],
  [8, "typo-fix"],
  [6, "formula"],
  [25, "insert-row"],
  [2, "delete-row"],
  [2, "move-rows"],
  [1, "sort"],
  [6, "paste-block"],
  [3, "clear-range"],
  [1, "column-op"],
];

export type SheetProfile = {
  name: string;
  rows: number;
  cols: number;
  users: number;
  /** Actions per workday, all users together. */
  actionsPerDay: number;
  /** One user works offline Monday to Wednesday and syncs on Thursday. */
  offlineUser: boolean;
};

export type SheetCheckpoint = {
  day: number;
  actions: number;
  sessions: number;
  rows: number;
  textBytes: number;
  sidecar: Sizes;
  compacted: Sizes;
  stats: StructStats;
  /** Saves so far, and the bytes an incremental save (delta since the server's state) would have sent. */
  saves: number;
  deltaBytes: number;
};

const id = (rng: Rng, prefix: string): string => {
  let s = prefix;
  for (let i = 0; i < 12; i += 1) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rng() * 36)];
  return s;
};

function cellValue(rng: Rng, col: number): string {
  switch (col % 5) {
    case 0:
      return `2026-${String(int(rng, 1, 12)).padStart(2, "0")}-${String(int(rng, 1, 28)).padStart(2, "0")}`;
    case 1:
      return words(rng, int(rng, 1, 3));
    case 2:
      return String(int(rng, 1, 5000));
    case 3:
      return (rng() * 1000).toFixed(2);
    default:
      return words(rng, int(rng, 2, 8));
  }
}

export function seedSheet(rng: Rng, rows: number, cols: number) {
  const c = Array.from({ length: cols }, (_, i) => ({ id: id(rng, "c"), ref: `kol${i}` }));
  const r = Array.from({ length: rows }, () => ({
    id: id(rng, "r"),
    cells: Object.fromEntries(c.map((col, j) => [col.id, cellValue(rng, j)])),
  }));
  return { cols: c, rows: r };
}

/** One action by one user on their replica. Keeps a cached row order between structural changes. */
class SheetActor {
  private order: string[] | null = null;
  constructor(
    readonly doc: Y.Doc,
    private readonly rng: Rng,
  ) {}

  private rows(): string[] {
    if (!this.order) this.order = L.rowOrder(this.doc);
    return this.order;
  }

  invalidate(): void {
    this.order = null;
  }

  act(action: SheetAction): void {
    const { doc, rng } = this;
    const rows = this.rows();
    const cols = L.colOrder(doc);
    if (rows.length === 0) {
      L.insertRow(doc, id(rng, "r"), null);
      this.invalidate();
      return;
    }
    // Recent rows are edited more: half the edits land in the last 10%.
    const someRow = () =>
      chance(rng, 0.5) ? (rows[rows.length - 1 - int(rng, 0, Math.max(0, Math.floor(rows.length / 10) - 1))] as string) : pick(rng, rows);
    const colIndex = () => int(rng, 0, cols.length - 1);
    switch (action) {
      case "retype": {
        const c = colIndex();
        L.setCell(doc, someRow(), cols[c] as string, cellValue(rng, c));
        return;
      }
      case "typo-fix": {
        const c = colIndex();
        const r = someRow();
        L.setCell(doc, r, cols[c] as string, cellValue(rng, c));
        L.setCell(doc, r, cols[c] as string, cellValue(rng, c));
        return;
      }
      case "formula": {
        const r = someRow();
        const a = L.colRef(doc, cols[2 % cols.length] as string);
        const b = L.colRef(doc, cols[3 % cols.length] as string);
        const lo = pick(rng, rows);
        const formula = chance(rng, 0.6) ? `=${a}@${r}*${b}@${r}` : `=SUM(${a}@${lo}:${a}@${pick(rng, rows)})`;
        L.setCell(doc, r, cols[cols.length - 1] as string, formula);
        return;
      }
      case "insert-row": {
        const rowId = id(rng, "r");
        const before = chance(rng, 0.7) ? null : pick(rng, rows);
        L.insertRow(doc, rowId, before);
        const n = int(rng, 2, cols.length);
        doc.transact(() => {
          for (let c = 0; c < n; c += 1) L.setCell(doc, rowId, cols[c] as string, cellValue(rng, c));
        }, "local");
        this.invalidate();
        return;
      }
      case "delete-row":
        L.deleteRow(doc, someRow());
        this.invalidate();
        return;
      case "move-rows": {
        const start = int(rng, 0, rows.length - 1);
        const ids = rows.slice(start, start + int(rng, 1, 3));
        L.moveRows(doc, ids, chance(rng, 0.1) ? null : pick(rng, rows));
        this.invalidate();
        return;
      }
      case "sort":
        L.sortRows(doc, cols[colIndex()] as string, chance(rng, 0.3));
        this.invalidate();
        return;
      case "paste-block": {
        const height = int(rng, 3, 20);
        const width = Math.min(cols.length, int(rng, 2, 5));
        const c0 = int(rng, 0, cols.length - width);
        const append = chance(rng, 0.15);
        doc.transact(() => {
          const start = int(rng, 0, Math.max(0, rows.length - height));
          for (let i = 0; i < height; i += 1) {
            let rowId = rows[start + i];
            if (append || rowId === undefined) {
              rowId = id(rng, "r");
              L.insertRow(doc, rowId, null);
            }
            for (let c = c0; c < c0 + width; c += 1) L.setCell(doc, rowId, cols[c] as string, cellValue(rng, c));
          }
        }, "local");
        this.invalidate();
        return;
      }
      case "clear-range": {
        const start = int(rng, 0, rows.length - 1);
        const c = colIndex();
        doc.transact(() => {
          for (const r of rows.slice(start, start + int(rng, 1, 10))) L.setCell(doc, r, cols[c] as string, "");
        }, "local");
        return;
      }
      case "column-op": {
        const op = weighted(rng, [
          [3, "rename"],
          [2, "insert"],
          [1, "delete"],
          [1, "move"],
        ] as const);
        if (op === "rename") L.renameCol(doc, cols[colIndex()] as string, `kol_${words(rng, 1)}`);
        else if (op === "insert") L.insertCol(doc, id(rng, "c"), `kol_${int(rng, 100, 999)}`, chance(rng, 0.5) ? null : pick(rng, cols));
        else if (op === "delete" && cols.length > 4) L.deleteCol(doc, pick(rng, cols));
        else L.moveCol(doc, pick(rng, cols), pick(rng, cols));
        return;
      }
    }
  }
}

/** One-way sync; the update's size when something arrived, else 0. */
function pull(from: Y.Doc, to: Y.Doc): number {
  const update = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to));
  if (update.byteLength <= 2) return 0;
  Y.applyUpdate(to, update, "remote");
  return update.byteLength;
}

export type SheetSimOptions = {
  days: number;
  seed: number;
  checkpointEvery: number;
  mix?: readonly (readonly [number, SheetAction])[];
  /** Measure what a compaction would leave at each checkpoint (costs a rebuild). */
  measureCompacted?: boolean;
};

/**
 * Runs the profile for `days` workdays and returns a checkpoint every
 * `checkpointEvery` days (plus day 0). The server copy is the merged state of
 * everything synced so far, which is what the sidecar holds.
 */
export function runSheetSim(profile: SheetProfile, options: SheetSimOptions): SheetCheckpoint[] {
  const rng = mulberry32(options.seed);
  const mix = options.mix ?? SHEET_MIX;
  const server = new Y.Doc();
  server.clientID = 1;
  const fixture = seedSheet(rng, profile.rows, profile.cols);
  L.seed(server, fixture.cols, fixture.rows, "seed");
  const replicas = Array.from({ length: profile.users }, () => {
    const doc = new Y.Doc();
    pull(server, doc);
    return doc;
  });
  const offline = profile.offlineUser ? profile.users - 1 : -1;
  let actions = 0;
  let sessions = 0;
  let saves = 0;
  let deltaBytes = 0;
  const out: SheetCheckpoint[] = [];
  const checkpoint = (day: number) => {
    const compacted = options.measureCompacted === false ? null : compact(sheetShape, server);
    out.push({
      day,
      actions,
      sessions,
      rows: L.rowOrder(server).length,
      textBytes: new TextEncoder().encode(sheetShape.text(server)).byteLength,
      sidecar: sizes(server),
      compacted: compacted ? sizes(compacted.doc) : { v1: 0, v2: 0, v1gz: 0, v2gz: 0 },
      stats: structStats(server),
      saves,
      deltaBytes,
    });
  };
  checkpoint(0);
  for (let day = 1; day <= options.days; day += 1) {
    const weekday = (day - 1) % 5; // 0 = Monday
    // Two to four sessions a day; their actions split the day's budget.
    const sessionCount = Math.min(profile.users, int(rng, 2, 4));
    const budget = Math.round(profile.actionsPerDay * (0.6 + rng() * 0.8));
    const today = distinctUsers(profile.users, sessionCount, rng);
    // The offline user's sessions do not sync until Thursday.
    const live = today.map((user) => {
      const doc = replicas[user] as Y.Doc;
      doc.clientID = sessionClientId(rng);
      sessions += 1;
      if (user !== offline) pull(server, doc);
      return { user, doc, actor: new SheetActor(doc, rng), left: Math.round(budget / sessionCount) };
    });
    // Sessions run interleaved in chunks of 5 actions; online ones sync after each chunk.
    while (live.some((s) => s.left > 0)) {
      for (const s of live) {
        if (s.left <= 0) continue;
        if (s.user !== offline && pull(server, s.doc)) s.actor.invalidate();
        for (let i = 0; i < 5 && s.left > 0; i += 1, s.left -= 1) {
          s.actor.act(weighted(rng, mix));
          actions += 1;
        }
        if (s.user !== offline) {
          const sent = pull(s.doc, server);
          if (sent > 0) {
            saves += 1;
            deltaBytes += sent;
          }
        }
      }
    }
    if (offline >= 0 && weekday === 3) {
      const doc = replicas[offline] as Y.Doc;
      const sent = pull(doc, server);
      if (sent > 0) {
        saves += 1;
        deltaBytes += sent;
      }
      pull(server, doc);
    }
    if (day % options.checkpointEvery === 0) checkpoint(day);
  }
  return out;
}
