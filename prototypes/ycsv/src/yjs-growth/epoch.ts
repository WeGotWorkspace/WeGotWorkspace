import * as Y from "yjs";
import { hash32 } from "./rng";

/**
 * Spike 10: compaction by *epoch*. A compaction rebuilds the document from its
 * current content into fresh Yjs items (no tombstones, no history, one client)
 * and names the result with a new epoch id. Items of two epochs must never meet
 * in one Y.Doc: both hold the whole document, so a merge would show it twice.
 *
 * - The rebuild is deterministic: the epoch id is a hash of the parent epoch and
 *   the state vector it compacted, and the items are written by a client id
 *   hashed from the epoch. Two clients compacting the same state produce the
 *   same bytes, and a peer can rebuild the epoch's base on its own.
 * - The epoch id lives in the document (root map `collab-epoch`), so a copy in
 *   IndexedDB knows which epoch it belongs to, and travels next to every
 *   update on the wire (header / mesh frame), so a receiver can refuse a
 *   foreign epoch before `applyUpdate`.
 * - A peer that holds edits the compaction did not see *rebases*: it merges its
 *   doc with the old epoch's final state (`archived`), takes the content diff
 *   against that final state, and replays it as ordinary operations on a
 *   rebuild of the new epoch's base. Those operations reference only base
 *   items, which every replica of the new epoch has, so they merge with
 *   whatever happened since the compaction.
 */
export interface CompactableShape<C> {
  id: string;
  /** Everything worth keeping, with the shape's own ids (row ids, comment ids). */
  snapshot(doc: Y.Doc): C;
  /** Write `content` as fresh items. Must be deterministic for a given client id. */
  build(target: Y.Doc, content: C): void;
  /**
   * Write `mine - base` into `target` (a rebuild of `base`) as local operations.
   * `mine` is `base` plus this peer's unseen edits, merged by Yjs, so the two
   * share item ids: a shape may diff by identity instead of by content.
   */
  replay(target: Y.Doc, base: Y.Doc, mine: Y.Doc): void;
  equal(a: C, b: C): boolean;
  /** The canonical file text. */
  text(doc: Y.Doc): string;
}

export const EPOCH_ROOT = "collab-epoch";
/** Documents that never compacted. */
export const GENESIS = "e0";

export function epochOf(doc: Y.Doc): string {
  if (!doc.share.has(EPOCH_ROOT)) return GENESIS;
  return String(doc.getMap(EPOCH_ROOT).get("id") ?? GENESIS);
}

function svKey(doc: Y.Doc): string {
  return [...Y.decodeStateVector(Y.encodeStateVector(doc))]
    .sort((a, b) => a[0] - b[0])
    .map(([c, k]) => `${c}:${k}`)
    .join(",");
}

export function nextEpochId(doc: Y.Doc): string {
  return `e${hash32(`${epochOf(doc)}|${svKey(doc)}`).toString(36)}`;
}

/** The new epoch's base, built from `content`: the same bytes on every client. */
export function buildEpochBase<C>(shape: CompactableShape<C>, content: C, epoch: string, parent: string): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = hash32(`epoch|${shape.id}|${epoch}`);
  doc.transact(() => {
    const meta = doc.getMap(EPOCH_ROOT);
    meta.set("id", epoch);
    meta.set("parent", parent);
  }, "compaction");
  shape.build(doc, content);
  return doc;
}

export type Compaction = { epoch: string; parent: string; doc: Y.Doc; update: Uint8Array };

export function compact<C>(shape: CompactableShape<C>, doc: Y.Doc): Compaction {
  const parent = epochOf(doc);
  const epoch = nextEpochId(doc);
  const base = buildEpochBase(shape, shape.snapshot(doc), epoch, parent);
  return { epoch, parent, doc: base, update: Y.encodeStateAsUpdate(base) };
}

export function docFrom(update: Uint8Array, clientID?: number): Y.Doc {
  const doc = new Y.Doc();
  if (clientID !== undefined) doc.clientID = clientID;
  Y.applyUpdate(doc, update, "load");
  return doc;
}

/**
 * True when `doc` has something `update` lacks: an item, or a deletion. A
 * replica whose only unsaved edits are deletions has the same state vector as
 * the server (deleting does not advance a Yjs clock), so the state vector
 * alone is not enough: the fuzz caught exactly that (deleted text came back).
 */
export function hasUnseen(doc: Y.Doc, update: Uint8Array): boolean {
  const theirs = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update));
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(doc))) {
    if (clock > (theirs.get(client) ?? 0)) return true;
  }
  const other = docFrom(update);
  const theirDeletes = Y.createDeleteSetFromStructStore(other.store);
  const mine = Y.createDeleteSetFromStructStore(doc.store);
  for (const [client, ranges] of mine.clients) {
    for (const range of ranges) {
      for (let clock = range.clock; clock < range.clock + range.len; clock += 1) {
        if (!Y.isDeleted(theirDeletes, Y.createID(client, clock))) return true;
      }
    }
  }
  return false;
}

/**
 * Bring an old-epoch replica into the new epoch without losing its edits.
 *
 * `archived` is the old epoch's final state, the one the compaction rebuilt
 * from (the server keeps it next to the sidecar). `current` is the new epoch's
 * state now. Returns the new-epoch doc for this peer, with its edits replayed,
 * and the update to send.
 */
export function rebase<C>(
  shape: CompactableShape<C>,
  local: Y.Doc,
  archived: Uint8Array,
  current: Uint8Array,
  clientID: number,
): { doc: Y.Doc; replayed: boolean; update: Uint8Array | null } {
  const next = docFrom(current, clientID);
  const finalOld = docFrom(archived);
  // The replay is this peer's own edits: written by `clientID` in a scratch
  // copy, then applied to `next` under a placeholder id (Yjs would otherwise
  // take a random new id when its own id arrives from outside), and `next`
  // continues as `clientID` after them.
  if (epochOf(local) !== epochOf(finalOld)) throw new Error("rebase: archive is not this replica's epoch");
  if (!hasUnseen(local, archived)) return { doc: next, replayed: false, update: null };
  const merged = docFrom(archived);
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(local, Y.encodeStateVector(merged)), "rebase");
  const base = shape.snapshot(finalOld);
  const mine = shape.snapshot(merged);
  if (shape.equal(base, mine)) return { doc: next, replayed: false, update: null };
  // Rebuild the new epoch's base on our own (same bytes as the compactor's),
  // replay our diff on it, then send only what the replay added.
  const epoch = epochOf(next);
  const seed = buildEpochBase(shape, base, epoch, epochOf(finalOld));
  const have = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(current)).get(seed.clientID) ?? 0;
  if (have < Y.getState(seed.store, seed.clientID)) {
    throw new Error(`rebase: rebuilt base of ${epoch} (client ${seed.clientID}) is not in the current state`);
  }
  const scratch = docFrom(Y.encodeStateAsUpdate(seed), clientID);
  shape.replay(scratch, finalOld, merged);
  const update = Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(seed));
  next.clientID = 0xfffffffe;
  Y.applyUpdate(next, update, "rebase");
  next.clientID = clientID;
  return { doc: next, replayed: true, update };
}

/**
 * The server, as far as compaction needs it: opaque bytes per document plus
 * the epoch id as a string column. It never parses Yjs. A save names the
 * epoch it was made in; a save from another epoch is refused (409), so an old
 * replica can never write old-epoch bytes over a compacted sidecar. A
 * compaction is a save with `compactFrom` = the epoch it replaces and the
 * sidecar tag it read; the old sidecar moves to the archive.
 */
export class EpochServer {
  sidecar: Uint8Array;
  epoch: string;
  /** Archived final states by epoch id. A real server keeps the last few (or for N days). */
  readonly archive = new Map<string, Uint8Array>();
  /** Bytes the server received, by kind: the cost of the save model. */
  received = { saves: 0, bytes: 0, compactions: 0, refused: 0 };

  constructor(initial: Uint8Array, epoch = GENESIS) {
    this.sidecar = initial;
    this.epoch = epoch;
  }

  /** Today's save model: the whole merged state, for the epoch the client is in. */
  save(epoch: string, state: Uint8Array): "ok" | "epoch_changed" {
    this.received.saves += 1;
    this.received.bytes += state.byteLength;
    if (epoch !== this.epoch) {
      this.received.refused += 1;
      return "epoch_changed";
    }
    this.sidecar = state;
    return "ok";
  }

  compact(fromEpoch: string, readSidecar: Uint8Array, next: Compaction): "ok" | "conflict" {
    this.received.bytes += next.update.byteLength;
    if (fromEpoch !== this.epoch || readSidecar !== this.sidecar) return "conflict";
    this.archive.set(this.epoch, this.sidecar);
    this.sidecar = next.update;
    this.epoch = next.epoch;
    this.received.compactions += 1;
    return "ok";
  }
}
