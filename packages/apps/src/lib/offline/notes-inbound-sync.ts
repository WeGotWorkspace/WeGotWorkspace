import {
  getNote,
  getNotebook,
  isNotesCannotCalculateChanges,
  isNotesNotFound,
  listNoteChanges,
  listNotebookChanges,
  listNotebooks,
  listNotes,
  noteFromVjournal,
} from "@/lib/api/wgw/notes-vjournal";
import {
  ingestRemoteNote,
  ingestRemoteNoteDestroyed,
  ingestRemoteNotebook,
  ingestRemoteNotebookDestroyed,
} from "@/lib/offline/notes-jmap-inbound";
import {
  listNoteIdsBlockingSyncToken,
  listOutboxNoteIds,
  readNotesBootstrapFromCache,
  readSyncToken,
  writeSyncToken,
} from "@/lib/offline/notes-offline-store";
import { runScopedInbound } from "@/lib/offline/core/inbound-sync";

type NoteRow = Awaited<ReturnType<typeof getNote>>;
type CachedNote = { id: string; scope: string | undefined; createPending: boolean };

export const NOTES_NOTEBOOKS_TOKEN_KEY = "__notebooks__";

export type NotesInboundSyncResult = {
  changed: boolean;
  usedFullResync: boolean;
};

async function syncNotebooks(username: string): Promise<{
  notebookIds: string[];
  changed: boolean;
  usedFullResync: boolean;
}> {
  const since = await readSyncToken(username, NOTES_NOTEBOOKS_TOKEN_KEY);
  try {
    const delta = await listNotebookChanges(since);
    let changed = false;
    for (const id of [...delta.created, ...delta.updated]) {
      const notebook = await getNotebook(id);
      await ingestRemoteNotebook(username, notebook);
      changed = true;
    }
    for (const id of delta.destroyed) {
      await ingestRemoteNotebookDestroyed(username, id);
      changed = true;
    }
    await writeSyncToken(username, NOTES_NOTEBOOKS_TOKEN_KEY, delta.newState);
    const cached = await readNotesBootstrapFromCache(username);
    const notebookIds = (cached?.data.notebookCollections ?? []).map((item) => item.id);
    return { notebookIds, changed, usedFullResync: false };
  } catch (error) {
    if (!isNotesCannotCalculateChanges(error)) throw error;
    const notebooks = await listNotebooks();
    for (const notebook of notebooks) {
      await ingestRemoteNotebook(username, notebook);
    }
    const delta = await listNotebookChanges(null);
    await writeSyncToken(username, NOTES_NOTEBOOKS_TOKEN_KEY, delta.newState);
    return {
      notebookIds: notebooks.map((item) => item.id),
      changed: true,
      usedFullResync: true,
    };
  }
}

/**
 * REST `/changes` inbound (reconnect / manual refresh / mock-tier fallback).
 * Live poll uses `POST /jmap` via `JmapNotesAdapter`. Notebooks first, then
 * per-visible-notebook items through the shared inbound engine. Full list with
 * no token or on `cannotCalculateChanges`.
 */
export async function syncNotesInboundFromRest(
  username: string,
  visibleNotebookIds?: readonly string[],
): Promise<NotesInboundSyncResult> {
  if (!username) return { changed: false, usedFullResync: false };

  const notebooks = await syncNotebooks(username);
  const remaining = notebooks.notebookIds;
  const ids =
    remaining.length > 0
      ? remaining
      : visibleNotebookIds && visibleNotebookIds.length > 0
        ? [...visibleNotebookIds]
        : [];

  const notes = await runScopedInbound<NoteRow, CachedNote>(ids, {
    readToken: (notebookId) => readSyncToken(username, notebookId),
    writeToken: (notebookId, token) => writeSyncToken(username, notebookId, token),
    changes: (notebookId, since) => listNoteChanges(notebookId, since),
    isCannotCalculateChanges: isNotesCannotCalculateChanges,
    // A full list is the whole notebook: what the cache has there and the list
    // lacks was deleted elsewhere. Its rows are ingested as they are (no GET each).
    list: (notebookId) => listNotes({ notebookId }),
    currentState: async (notebookId) => (await listNoteChanges(notebookId, null)).newState,
    rowId: (row) => row.id,
    fetch: (id) => getNote(id),
    readCached: async () => {
      const cachedBefore = await readNotesBootstrapFromCache(username);
      // Still in the outbox is "not sent yet", not "deleted": leave those alone.
      const queuedIds = await listOutboxNoteIds(username);
      return {
        items: (cachedBefore?.data.notes ?? []).map((note) => ({
          id: note.id,
          scope: note.notebookId,
          createPending: Boolean(note.createPending),
        })),
        keep: (note) => note.createPending || queuedIds.has(note.id),
      };
    },
    scopeGone: {
      matches: isNotesNotFound,
      apply: (notebookId) => ingestRemoteNotebookDestroyed(username, notebookId).then(() => {}),
    },
    createApplier: async () => {
      const cached = await readNotesBootstrapFromCache(username);
      const notebookRows = cached?.data.notebookCollections ?? [];
      return {
        ingest: (row) => ingestRemoteNote(username, noteFromVjournal(row, notebookRows)),
        ingestDestroyed: (id) => ingestRemoteNoteDestroyed(username, id),
        // A stateMismatch row is absent here, so it does not pin a token.
        blocksToken: await listNoteIdsBlockingSyncToken(username),
      };
    },
  });

  return {
    changed: notebooks.changed || notes.changed,
    usedFullResync: notebooks.usedFullResync || notes.usedFullResync,
  };
}
