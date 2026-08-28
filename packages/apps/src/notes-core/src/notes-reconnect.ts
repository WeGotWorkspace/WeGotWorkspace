export type NotesReconnectAction = "continue" | "reseed" | "persist" | "conflict";

export type NotesReconnectInput = {
  localDirty: boolean;
  etagChanged: boolean;
};

/**
 * Offline / focus reconnect matrix (architecture Decision 8).
 * Dirty + stale etag must never silent-reseed.
 */
export function resolveNotesReconnect(input: NotesReconnectInput): NotesReconnectAction {
  if (!input.localDirty && !input.etagChanged) return "continue";
  if (!input.localDirty && input.etagChanged) return "reseed";
  if (input.localDirty && !input.etagChanged) return "persist";
  return "conflict";
}
