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
  readNotesBootstrapFromCache,
  readSyncToken,
  writeSyncToken,
} from "@/lib/offline/notes-offline-store";

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
 * REST `/changes` inbound: notebooks first, then per-visible-notebook items.
 * Full list only on `cannotCalculateChanges`.
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

  const deltas: Array<{
    notebookId: string;
    created: string[];
    updated: string[];
    destroyed: string[];
    newState: string;
    usedFullResync: boolean;
  }> = [];

  let usedFullResync = notebooks.usedFullResync;
  let changed = notebooks.changed;
  for (const notebookId of ids) {
    const since = await readSyncToken(username, notebookId);
    try {
      const delta = await listNoteChanges(notebookId, since);
      deltas.push({
        notebookId,
        created: delta.created,
        updated: delta.updated,
        destroyed: delta.destroyed,
        newState: delta.newState,
        usedFullResync: false,
      });
    } catch (error) {
      if (isNotesNotFound(error)) {
        await ingestRemoteNotebookDestroyed(username, notebookId);
        changed = true;
        continue;
      }
      if (!isNotesCannotCalculateChanges(error)) throw error;
      usedFullResync = true;
      const items = await listNotes({ notebookId });
      deltas.push({
        notebookId,
        created: items.map((item) => item.id),
        updated: [],
        destroyed: [],
        newState: (await listNoteChanges(notebookId, null)).newState,
        usedFullResync: true,
      });
    }
  }

  const created = new Set<string>();
  const updated = new Set<string>();
  const destroyed = new Set<string>();
  for (const delta of deltas) {
    for (const id of delta.created) created.add(id);
    for (const id of delta.updated) updated.add(id);
    for (const id of delta.destroyed) destroyed.add(id);
  }
  const upsertIds = [...created, ...[...updated].filter((id) => !created.has(id))];
  const destroyIds = [...destroyed].filter((id) => !created.has(id) && !updated.has(id));

  const cached = await readNotesBootstrapFromCache(username);
  const notebookRows = cached?.data.notebookCollections ?? [];
  for (const id of upsertIds) {
    const row = await getNote(id);
    const result = await ingestRemoteNote(username, noteFromVjournal(row, notebookRows));
    if (result === "upserted") changed = true;
  }
  for (const id of destroyIds) {
    const result = await ingestRemoteNoteDestroyed(username, id);
    if (result === "removed") changed = true;
  }
  for (const delta of deltas) {
    await writeSyncToken(username, delta.notebookId, delta.newState);
    usedFullResync = usedFullResync || delta.usedFullResync;
  }

  return { changed, usedFullResync };
}
