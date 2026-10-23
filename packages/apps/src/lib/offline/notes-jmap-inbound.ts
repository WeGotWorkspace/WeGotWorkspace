import type { Note } from "@/lib/models/note";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import { noteTagsEqual } from "@/notes-core/src/notes-note-utils";
import {
  getNoteFromCache,
  listOutboxNoteIds,
  listPendingNoteBases,
  listPendingNoteFields,
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
 * Ingest a remote note into Dexie. Only the fields this note has queued in the
 * outbox are held back; everything else is adopted. A conflict is reported only
 * when the inbound change touches a queued field (#1351) and the server's
 * version moved since that write was queued: with the same version, the server
 * simply has not seen the change yet (another tab queued it offline).
 */
export async function ingestRemoteNote(
  username: string,
  note: Note,
): Promise<"upserted" | "merged-pending" | "skipped-pending"> {
  if (!note.id) return "skipped-pending";
  const pendingFields = (await listPendingNoteFields(username)).get(note.id);
  // A queued delete is not a cache write. merged-pending would make REST
  // sync report changed without ingesting the remote row.
  if (pendingFields?.has("delete")) return "skipped-pending";
  if (!pendingFields || pendingFields.size === 0) {
    await upsertNoteInCache(username, note, false);
    return "upserted";
  }
  const local = await getNoteFromCache(username, note.id);
  if (!local) {
    await upsertNoteInCache(username, note, true);
    return "merged-pending";
  }
  const merged: Note = { ...note };
  const conflicting: string[] = [];
  if (pendingFields.has("title")) {
    merged.title = local.title;
    if (note.title !== local.title) conflicting.push("title");
  }
  if (pendingFields.has("tags")) {
    merged.tags = local.tags;
    if (!noteTagsEqual(note.tags, local.tags)) conflicting.push("tags");
  }
  if (pendingFields.has("starred")) {
    merged.starred = local.starred;
    if (note.starred !== local.starred) conflicting.push("starred");
  }
  if (pendingFields.has("archived")) {
    merged.archived = local.archived;
    if (note.archived !== local.archived) conflicting.push("archived");
  }
  if (pendingFields.has("notebook")) {
    merged.notebook = local.notebook;
    merged.notebookId = local.notebookId;
    if (note.notebookId !== local.notebookId) conflicting.push("notebook");
  }
  await upsertNoteInCache(username, merged, true);
  if (conflicting.length > 0 && (await serverMovedSinceQueued(username, note))) {
    reportNotesSyncConflicts([note.id]);
  }
  return "merged-pending";
}

/**
 * True when the server's version differs from a version a queued write of this
 * note started from. A write that recorded no version counts as moved, as before.
 */
async function serverMovedSinceQueued(username: string, note: Note): Promise<boolean> {
  const bases = (await listPendingNoteBases(username)).get(note.id) ?? [];
  if (bases.length === 0 || !note.etag) return true;
  return bases.some((base) => base !== note.etag);
}

/** Drop a remotely destroyed note unless a local pending write still owns the id. */
export async function ingestRemoteNoteDestroyed(
  username: string,
  noteId: string,
): Promise<"removed" | "skipped-pending"> {
  const pending = await listOutboxNoteIds(username);
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
