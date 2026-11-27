import { gzipSync } from "node:zlib";
import * as Y from "yjs";

/**
 * Spike 10: what a sidecar costs on disk and on the wire, four ways. gzip at
 * level 6 (zlib's default, what `CompressionStream("gzip")` gives in browsers).
 */
export type Sizes = { v1: number; v2: number; v1gz: number; v2gz: number };

export function sizes(doc: Y.Doc): Sizes {
  const v1 = Y.encodeStateAsUpdate(doc);
  const v2 = Y.encodeStateAsUpdateV2(doc);
  return {
    v1: v1.byteLength,
    v2: v2.byteLength,
    v1gz: gzipSync(v1, { level: 6 }).byteLength,
    v2gz: gzipSync(v2, { level: 6 }).byteLength,
  };
}

export function sizesOfUpdate(update: Uint8Array): Sizes {
  const v2 = Y.convertUpdateFormatV1ToV2(update);
  return {
    v1: update.byteLength,
    v2: v2.byteLength,
    v1gz: gzipSync(update, { level: 6 }).byteLength,
    v2gz: gzipSync(v2, { level: 6 }).byteLength,
  };
}

/** What the state is made of: live items, tombstones (deleted items), GC'd structs, clients. */
export type StructStats = {
  clients: number;
  structs: number;
  liveItems: number;
  deletedItems: number;
  gcStructs: number;
  /** Ranges in the delete set (each costs a few bytes). */
  deleteRanges: number;
};

export function structStats(doc: Y.Doc): StructStats {
  let structs = 0;
  let liveItems = 0;
  let deletedItems = 0;
  let gcStructs = 0;
  for (const list of doc.store.clients.values()) {
    for (const struct of list) {
      structs += 1;
      if (struct instanceof Y.GC) gcStructs += 1;
      else if (struct instanceof Y.Item) {
        if (struct.deleted) deletedItems += 1;
        else liveItems += 1;
      }
    }
  }
  const ds = Y.createDeleteSetFromStructStore(doc.store);
  let deleteRanges = 0;
  for (const ranges of ds.clients.values()) deleteRanges += ranges.length;
  return { clients: doc.store.clients.size, structs, liveItems, deletedItems, gcStructs, deleteRanges };
}

export const kib = (bytes: number): number => Math.round((bytes / 1024) * 10) / 10;

/** The current Docs/Sheets save body cap, for "when do we hit it". */
export const MAX_YJS_BYTES = 5_242_880;
