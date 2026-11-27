import * as Y from "yjs";
import { LOCAL, undoScope } from "../model/workbook";

/**
 * Per-user undo over the whole workbook (spike 5), one step per gesture (spike 6:
 * `captureTimeout: 0`, Yjs' 500 ms merge joined separate edits), with spike 9's guard.
 * One manager per person and doc, shared by every sheet tab: undo follows the person's own
 * history across tabs, and the grid switches to the step's tab (stack item meta `sheet`).
 */
export function createSheetUndoManager(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager(undoScope(doc), { trackedOrigins: new Set([LOCAL]), captureTimeout: 0 });
}

/** Every `Y.Array` in the layout is an order (rows, columns, sheets). */
function isOrder(parent: unknown): boolean {
  return parent instanceof Y.Array;
}

/**
 * Spike 9: plain undo of a move restores my old order entry; if a peer moved the same row
 * since, the row jumps back over the peer's newer move. A step whose inserted order entries
 * are gone (and have no live redone copy) is stale.
 */
export function topUndoIsStaleMove(doc: Y.Doc, undo: Y.UndoManager): boolean {
  const step = undo.undoStack[undo.undoStack.length - 1];
  if (!step) return false;
  let stale = false;
  doc.transact((tr) => {
    Y.iterateDeletedStructs(tr, step.insertions, (struct) => {
      if (!(struct instanceof Y.Item) || !isOrder(struct.parent)) return;
      // A whole sheet or row created by this step and deleted by my own undo/redo chain is fine.
      let item: Y.Item = struct;
      while (item.deleted && item.redone !== null) {
        const next = Y.getItem(doc.store, item.redone);
        if (!(next instanceof Y.Item)) break;
        item = next;
      }
      if (item.deleted) stale = true;
    });
  }, "inspect");
  return stale;
}

export function guardedUndo(doc: Y.Doc, undo: Y.UndoManager): "undone" | "dropped" | "empty" {
  if (undo.undoStack.length === 0) return "empty";
  if (topUndoIsStaleMove(doc, undo)) {
    undo.undoStack.pop();
    return "dropped";
  }
  undo.undo();
  return "undone";
}
