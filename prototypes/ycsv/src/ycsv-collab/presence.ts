import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

/**
 * What one person shows the others in a sheet (spike 5). Cells are named by
 * stable ids, never by index: a row inserted above moves the highlight with
 * the row, as the formulas move.
 *
 * Lives in the awareness state under `sheet`, next to the `user` field Docs
 * already publishes ({ name, color }), so the avatar strip, peer list and
 * colour assignment from docs-collab presence work unchanged.
 */
export type CellRef = { rowId: string; colId: string };

export type SheetPresence = {
  /** The cell with the focus ring. */
  active: CellRef | null;
  /** The selected range, anchor to head (head is usually `active`). Null for a single cell. */
  range: { anchor: CellRef; head: CellRef } | null;
  /** True while the person types in the active cell (cell editor open). */
  editing: boolean;
};

export const SHEET_PRESENCE_FIELD = "sheet";

export function setLocalSheetPresence(awareness: Awareness, presence: SheetPresence): void {
  awareness.setLocalStateField(SHEET_PRESENCE_FIELD, presence);
}

export type PeerSheetPresence = SheetPresence & {
  clientId: number;
  name: string;
  color: string;
};

/** Everyone else's sheet presence, read from the awareness states. */
export function readPeerSheetPresence(awareness: Awareness): PeerSheetPresence[] {
  const peers: PeerSheetPresence[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const sheet = state[SHEET_PRESENCE_FIELD] as SheetPresence | undefined;
    if (!sheet) return;
    const user = (state.user ?? {}) as { name?: string; color?: string };
    peers.push({ ...sheet, clientId, name: user.name ?? "", color: user.color ?? "#888" });
  });
  return peers;
}

/**
 * A range as index bounds on the current document, or null when one of its
 * cells is gone (row or column deleted by someone else: the highlight drops).
 */
export function resolveRange(
  doc: Y.Doc,
  range: { anchor: CellRef; head: CellRef },
): { top: number; bottom: number; left: number; right: number } | null {
  const rowIndex = new Map<string, number>();
  const rows = doc.getArray<Y.Map<unknown>>("rows");
  for (let i = 0; i < rows.length; i += 1) rowIndex.set(String(rows.get(i).get("rowId")), i);
  const colIndex = new Map<string, number>();
  const columns = doc.getArray<Y.Map<unknown>>("columns");
  for (let i = 0; i < columns.length; i += 1) colIndex.set(String(columns.get(i).get("colId")), i);
  const r1 = rowIndex.get(range.anchor.rowId);
  const r2 = rowIndex.get(range.head.rowId);
  const c1 = colIndex.get(range.anchor.colId);
  const c2 = colIndex.get(range.head.colId);
  if (r1 === undefined || r2 === undefined || c1 === undefined || c2 === undefined) return null;
  return {
    top: Math.min(r1, r2),
    bottom: Math.max(r1, r2),
    left: Math.min(c1, c2),
    right: Math.max(c1, c2),
  };
}
