import * as Y from "yjs";

/** The origin every local sheet edit carries (src/ycsv-model/mutate.ts). */
export const LOCAL_EDIT_ORIGIN = "local";

/**
 * Per-user undo: tracks only this client's own edits (origin `local`). An
 * update from a peer, the server, a tab or a seed arrives with another origin
 * and is never undone here. Undoing a cell set removes this person's value;
 * if a peer wrote the cell after, the peer's value stays (Yjs undo deletes
 * only the person's own items).
 */
export function createSheetUndoManager(doc: Y.Doc, captureTimeout = 500): Y.UndoManager {
  return new Y.UndoManager(
    [doc.getArray("columns"), doc.getArray("rows"), doc.getMap("meta"), doc.getMap("raw")],
    { trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]), captureTimeout },
  );
}
