import {
  getNote,
  getNotebook,
  isNotesCannotCalculateChanges,
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
  readNotesBootstrapFromCache,
  readSyncToken,
  writeSyncToken,
} from "@/lib/offline/notes-offline-store";

export const NOTES_NOTEBOOKS_TOKEN_KEY = "__notebooks__";

export type NotesInboundSyncResult = {
  changed: boolean;
  usedFullResync: boolean;
};

async function ingestChangedNotes(
  username: string,
  notebookId: string,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return false;
  const cached = await readNotesBootstrapFromCache(username);
  const notebooks = cached?.data.notebookCollections ?? [];
  let changed = false;
  for (const id of ids) {
    const row = await getNote(id);
    const note = noteFromVjournal(row, notebooks);
    const result = await ingestRemoteNote(username, note);
    if (result === "upserted") changed = true;
  }
  return changed;
}

async function resyncNotebook(username: string, notebookId: string): Promise<boolean> {
  const cached = await readNotesBootstrapFromCache(username);
  const notebooks = cached?.data.notebookCollections ?? [];
  const items = await listNotes({ notebookId });
  let changed = false;
  for (const item of items) {
    const result = await ingestRemoteNote(username, noteFromVjournal(item, notebooks));
    if (result === "upserted") changed = true;
  }
  return changed;
}

async function syncOneNotebook(
  username: string,
  notebookId: string,
): Promise<{ changed: boolean; usedFullResync: boolean }> {
  const since = await readSyncToken(username, notebookId);
  try {
    const delta = await listNoteChanges(notebookId, since);
    let changed = false;
    changed =
      (await ingestChangedNotes(username, notebookId, [...delta.created, ...delta.updated])) ||
      changed;
    for (const id of delta.destroyed) {
      const result = await ingestRemoteNoteDestroyed(username, id);
      if (result === "removed") changed = true;
    }
    await writeSyncToken(username, notebookId, delta.newState);
    return { changed, usedFullResync: false };
  } catch (error) {
    if (!isNotesCannotCalculateChanges(error)) throw error;
    const changed = await resyncNotebook(username, notebookId);
    const delta = await listNoteChanges(notebookId, null);
    await writeSyncToken(username, notebookId, delta.newState);
    return { changed, usedFullResync: true };
  }
}

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
 * REST `/changes` inbound: notebooks first, then per-visible-notebook items.
 * Full list only on `cannotCalculateChanges`.
 */
export async function syncNotesInboundFromRest(
  username: string,
  visibleNotebookIds?: readonly string[],
): Promise<NotesInboundSyncResult> {
  if (!username) return { changed: false, usedFullResync: false };

  const notebooks = await syncNotebooks(username);
  const ids =
    visibleNotebookIds && visibleNotebookIds.length > 0
      ? [...visibleNotebookIds]
      : notebooks.notebookIds;

  let changed = notebooks.changed;
  let usedFullResync = notebooks.usedFullResync;
  for (const notebookId of ids) {
    const result = await syncOneNotebook(username, notebookId);
    changed = changed || result.changed;
    usedFullResync = usedFullResync || result.usedFullResync;
  }

  return { changed, usedFullResync };
}
