import type { Note } from "@/lib/models/note";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import {
  listPendingNoteIds,
  removeNoteFromCache,
  removeNotebookFromCache,
  upsertNoteInCache,
  upsertNotebookInCache,
  readNotesBootstrapFromCache,
} from "@/lib/offline/notes-offline-store";
import { reportNotesSyncConflicts } from "@/lib/offline/notes-sync-conflicts";

async function pendingSet(username: string): Promise<Set<string>> {
  return new Set(await listPendingNoteIds(username));
}

/**
 * Ingest a remote note into Dexie. Pending outbox / pendingSync rows are
 * not overwritten; a clash still goes through `reportNotesSyncConflicts`.
 */
export async function ingestRemoteNote(
  username: string,
  note: Note,
): Promise<"upserted" | "skipped-pending"> {
  if (!note.id) return "skipped-pending";
  const pending = await pendingSet(username);
  if (pending.has(note.id)) {
    reportNotesSyncConflicts([note.id]);
    return "skipped-pending";
  }
  await upsertNoteInCache(username, note, false);
  return "upserted";
}

/** Drop a remotely destroyed note unless a local pending write still owns the id. */
export async function ingestRemoteNoteDestroyed(
  username: string,
  noteId: string,
): Promise<"removed" | "skipped-pending"> {
  const pending = await pendingSet(username);
  if (pending.has(noteId)) {
    reportNotesSyncConflicts([noteId]);
    return "skipped-pending";
  }
  await removeNoteFromCache(username, noteId);
  return "removed";
}

/** Upsert a remote notebook into the Dexie notebook list. */
export async function ingestRemoteNotebook(
  username: string,
  notebook: NotesNotebookCollection,
): Promise<"upserted"> {
  await upsertNotebookInCache(username, notebook);
  return "upserted";
}

/**
 * Drop a remotely destroyed notebook and its cached notes. Pending outbox
 * note rows stay so flush/conflict handling can run.
 */
export async function ingestRemoteNotebookDestroyed(
  username: string,
  notebookId: string,
): Promise<"removed"> {
  const pending = await pendingSet(username);
  const cached = await readNotesBootstrapFromCache(username);
  const notes = cached?.data.notes ?? [];
  const conflicts: string[] = [];
  for (const note of notes) {
    if (note.notebookId !== notebookId && note.notebook !== notebookId) continue;
    if (pending.has(note.id)) {
      conflicts.push(note.id);
      continue;
    }
    await removeNoteFromCache(username, note.id);
  }
  if (conflicts.length > 0) {
    reportNotesSyncConflicts(conflicts);
  }
  await removeNotebookFromCache(username, notebookId);
  return "removed";
}

/**
 * Full snapshot after cannotCalculateChanges: upsert remote rows, then drop
 * local notebooks/notes that are gone (pending note writes stay).
 */
export async function reconcileNotesSnapshot(
  username: string,
  notes: Note[],
  notebooks: NotesNotebookCollection[],
): Promise<void> {
  const pending = await pendingSet(username);
  const cached = await readNotesBootstrapFromCache(username);
  const remoteNoteIds = new Set(notes.map((note) => note.id));
  const remoteNotebookIds = new Set(notebooks.map((notebook) => notebook.id));

  for (const notebook of notebooks) {
    await ingestRemoteNotebook(username, notebook);
  }
  for (const note of notes) {
    await ingestRemoteNote(username, note);
  }
  for (const note of cached?.data.notes ?? []) {
    if (remoteNoteIds.has(note.id) || pending.has(note.id)) continue;
    await removeNoteFromCache(username, note.id);
  }
  for (const notebook of cached?.data.notebookCollections ?? []) {
    if (remoteNotebookIds.has(notebook.id)) continue;
    await removeNotebookFromCache(username, notebook.id);
  }
}
