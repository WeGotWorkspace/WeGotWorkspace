import type { Awareness } from "y-protocols/awareness";

/**
 * What one person shows the others (spike 5's payload, merged with spike 6's multi-range
 * selection and the integration slice's sheet tabs). Cells by stable ids: a row inserted
 * above moves the highlight with the row. Lives under `sheet` in the awareness state, next to
 * the `user` field ({ name, color }) the Docs presence chrome already reads.
 */
export type CellRef = { rowId: string; colId: string };
export type RangeRef = { anchor: CellRef; head: CellRef };

export type SheetPresence = {
  /** The tab this person is on. Peers on another tab show in the tab strip only. */
  sheetId: string;
  active: CellRef | null;
  /** Every selected range (spike 6: Cmd/Ctrl+click adds ranges). Empty for a single cell. */
  ranges: RangeRef[];
  /** True while the person types in the active cell. */
  editing: boolean;
};

export const SHEET_PRESENCE_FIELD = "sheet";

export function setLocalSheetPresence(awareness: Awareness, presence: SheetPresence): void {
  awareness.setLocalStateField(SHEET_PRESENCE_FIELD, presence);
}

export type PeerSheetPresence = SheetPresence & { clientId: number; name: string; color: string };

export function readPeerSheetPresence(awareness: Awareness): PeerSheetPresence[] {
  const peers: PeerSheetPresence[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const sheet = state[SHEET_PRESENCE_FIELD] as SheetPresence | undefined;
    if (!sheet || typeof sheet.sheetId !== "string") return;
    const user = (state.user ?? {}) as { name?: string; color?: string };
    peers.push({ ...sheet, ranges: sheet.ranges ?? [], clientId, name: user.name ?? "", color: user.color ?? "#888" });
  });
  return peers;
}
