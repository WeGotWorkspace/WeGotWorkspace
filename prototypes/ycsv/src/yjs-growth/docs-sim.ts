import * as Y from "yjs";
import { type DocAction, DOC_MIX, type DocView, USERS, initialDocBlocks, nextDocAction } from "./docs-script";
import { applyDocOp, docView, docsShape, seedDocs } from "./docs-raw";
import { compact } from "./epoch";
import { type Sizes, type StructStats, sizes, structStats } from "./measure";
import { distinctUsers, int, mulberry32, sessionClientId } from "./rng";

/**
 * Spike 10: months of ordinary use of one document by several people, on the
 * raw-Yjs Docs model. Same session model as the Sheets run: a fresh client id
 * per browser session, online sessions sync every few actions, two people
 * sometimes type at the same time, one person works offline Monday to
 * Wednesday and merges on Thursday.
 */
export type DocsProfile = {
  name: string;
  /** Blocks at day 0 (a page is roughly 10–12 blocks). */
  blocks: number;
  users: number;
  /** Editing actions per workday, all users together (an action is a sentence typed, a format, a comment…). */
  actionsPerDay: number;
  offlineUser: boolean;
  mix?: readonly (readonly [number, DocAction])[];
};

export type DocsCheckpoint = {
  day: number;
  actions: number;
  sessions: number;
  blocks: number;
  textBytes: number;
  sidecar: Sizes;
  compacted: Sizes;
  stats: StructStats;
  /** Saves so far, and the bytes an incremental save (delta since the server's state) would have sent. */
  saves: number;
  deltaBytes: number;
};

/** One-way sync; the update's size when something arrived, else 0. */
function pull(from: Y.Doc, to: Y.Doc): number {
  const update = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to));
  if (update.byteLength <= 2) return 0;
  Y.applyUpdate(to, update, "remote");
  return update.byteLength;
}

export function runDocsSim(
  profile: DocsProfile,
  options: { days: number; seed: number; checkpointEvery: number; measureCompacted?: boolean },
): DocsCheckpoint[] {
  const rng = mulberry32(options.seed);
  const mix = profile.mix ?? DOC_MIX;
  const server = new Y.Doc();
  server.clientID = 1;
  seedDocs(server, initialDocBlocks(rng, profile.blocks));
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
  const out: DocsCheckpoint[] = [];
  const checkpoint = (day: number) => {
    const compacted = options.measureCompacted === false ? null : compact(docsShape, server);
    out.push({
      day,
      actions,
      sessions,
      blocks: server.getXmlFragment("default").length,
      textBytes: new TextEncoder().encode(docsShape.text(server)).byteLength,
      sidecar: sizes(server),
      compacted: compacted ? sizes(compacted.doc) : { v1: 0, v2: 0, v1gz: 0, v2gz: 0 },
      stats: structStats(server),
      saves,
      deltaBytes,
    });
  };
  checkpoint(0);
  for (let day = 1; day <= options.days; day += 1) {
    const weekday = (day - 1) % 5;
    const sessionCount = Math.min(profile.users, int(rng, 1, 4));
    const users = distinctUsers(profile.users, sessionCount, rng);
    const budget = Math.round(profile.actionsPerDay * (0.4 + rng() * 1.2));
    const live = users.map((user) => {
      const doc = replicas[user] as Y.Doc;
      doc.clientID = sessionClientId(rng);
      sessions += 1;
      if (user !== offline) pull(server, doc);
      return { user, doc, view: null as DocView | null, left: Math.round(budget / sessionCount) };
    });
    while (live.some((s) => s.left > 0)) {
      for (const s of live) {
        if (s.left <= 0) continue;
        if (s.user !== offline && pull(server, s.doc)) s.view = null;
        if (!s.view) s.view = docView(s.doc);
        for (let i = 0; i < 3 && s.left > 0; i += 1, s.left -= 1) {
          for (const op of nextDocAction(rng, s.view, day, USERS[s.user % USERS.length] as string, mix)) applyDocOp(s.doc, op);
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


