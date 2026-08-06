import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { Note } from "@/lib/models/note";
import { rememberOfflineNotesUsername } from "@/lib/offline/offline-session";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { enqueueCoalescedOutboxUpdate } from "@/lib/offline/core/outbox-coalescing";
import {
  isRetryableOutboxRow,
  listOutboxMutationsForDomain,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  NOTES_DOMAIN,
  notesNotebooksTable,
  notesNotesTable,
  type OfflineNoteRow,
} from "@/lib/offline/notes/notes-schema";
import { enrichNote, noteHasListableBody } from "@/notes-core/src/notes-note-utils";

export {
  enqueueOutboxMutation,
  listOutboxMutations,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";

const META_SESSION = "notes:session";

/**
 * Frontmatter metadata coalesced through the Notes outbox. The note **body** is
 * intentionally excluded — body lives in the Docs Yjs collab document and is
 * never sent through the Notes metadata API.
 */
export type NoteUpsertMetadata = {
  notebook: string;
  tags: string[];
  starred?: boolean;
  archived?: boolean;
};

export type NotesUpsertPayload = {
  noteId: string;
  metadata: NoteUpsertMetadata;
  tempNoteId?: string;
};

/** Pull only the outbox-tracked metadata fields off a note (drops body/excerpt). */
export function extractNoteMetadata(note: Note): NoteUpsertMetadata {
  return {
    notebook: note.notebook,
    tags: note.tags,
    ...(note.starred !== undefined ? { starred: note.starred } : {}),
    ...(note.archived !== undefined ? { archived: note.archived } : {}),
  };
}

function metaKeyForNotebookState(notebook: string): string {
  return `notes:notebook:${notebook}:state`;
}

function noteRow(note: Note, pendingSync: boolean): OfflineNoteRow {
  return {
    id: note.id,
    notebookId: note.notebook,
    data: JSON.stringify(note),
    pendingSync,
    updatedAt: Date.now(),
  };
}

function tagsFromNotes(notes: Note[]): string[] {
  return [...new Set(notes.flatMap((n) => n.tags))];
}

export async function readNotesBootstrapFromCache(
  username: string,
): Promise<NotesAppBootstrap | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const sessionRow = await db.meta.get(META_SESSION);
  if (!sessionRow?.value) return null;

  const books = await notesNotebooksTable(db).toArray();
  const notes = await notesNotesTable(db).toArray();
  if (books.length === 0 && notes.length === 0) return null;

  const session = JSON.parse(sessionRow.value) as NotesAppBootstrap["session"];
  const notebooks = books.map((row) => row.id);
  const noteEntities = notes.map((row) => JSON.parse(row.data) as Note);

  return {
    session,
    data: {
      notes: noteEntities,
      notebooks,
      tags: tagsFromNotes(noteEntities),
    },
  };
}

export async function writeNotesBootstrapToCache(
  username: string,
  bootstrap: NotesAppBootstrap,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const notes = notesNotesTable(db);
  const books = notesNotebooksTable(db);
  const pendingRows = await notes.filter((row) => row.pendingSync).toArray();
  await db.meta.put({ key: META_SESSION, value: JSON.stringify(bootstrap.session) });
  rememberOfflineNotesUsername(username);
  await books.clear();
  await books.bulkPut(
    bootstrap.data.notebooks.map((name) => ({
      id: name,
      data: JSON.stringify({ name }),
    })),
  );
  await notes.clear();
  const serverNotes = bootstrap.data.notes.map((note) => enrichNote(note));
  await notes.bulkPut(serverNotes.map((note) => noteRow(note, false)));
  if (pendingRows.length > 0) {
    const serverById = new Map(serverNotes.map((note) => [note.id, note]));
    // Pending metadata must not wipe a server body that the local row never got
    // (common for pre-optimistic-sync historical notes → “Untitled note” in list).
    const mergedPending = pendingRows.map((row) => {
      let pending: Note;
      try {
        pending = JSON.parse(row.data) as Note;
      } catch {
        return row;
      }
      const server = serverById.get(row.id);
      if (server && !noteHasListableBody(pending) && noteHasListableBody(server)) {
        return noteRow(
          enrichNote({
            ...pending,
            body: server.body,
            excerpt: server.excerpt,
            wordCount: server.wordCount,
            date: server.date !== "—" ? server.date : pending.date,
          }),
          true,
        );
      }
      return noteRow(enrichNote(pending), true);
    });
    await notes.bulkPut(mergedPending);
  }
}

export async function upsertNoteInCache(
  username: string,
  note: Note,
  pendingSync = false,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await notesNotesTable(db).put(noteRow(note, pendingSync));
}

export async function removeNoteFromCache(username: string, noteId: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await notesNotesTable(db).delete(noteId);
}

export async function listFailedNotesOutbox(username: string): Promise<OfflineOutboxRow[]> {
  const rows = await listOutboxMutationsForDomain(username, NOTES_DOMAIN);
  return rows.filter(isRetryableOutboxRow);
}

export async function listPendingNoteIds(username: string): Promise<string[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await notesNotesTable(db)
    .filter((row) => row.pendingSync)
    .toArray();
  return rows.map((row) => row.id);
}

export async function readSyncToken(username: string, notebook: string): Promise<string | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await db.meta.get(metaKeyForNotebookState(notebook));
  return row?.value ?? null;
}

export async function writeSyncToken(
  username: string,
  notebook: string,
  token: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.meta.put({ key: metaKeyForNotebookState(notebook), value: token });
}

/** Note id targeted by an outbox row (upsert/delete `noteId`, or create `tempNoteId`). */
export function notesOutboxNoteId(row: OfflineOutboxRow): string | null {
  if (row.domain !== NOTES_DOMAIN) return null;
  try {
    const payload = JSON.parse(row.payload) as {
      noteId?: string;
      tempNoteId?: string;
    };
    return payload.noteId ?? payload.tempNoteId ?? null;
  } catch {
    return null;
  }
}

/** Drop pending outbox rows for a note so a delete is not undone by a later upsert flush. */
export async function removeOutboxMutationsForNote(
  username: string,
  noteId: string,
): Promise<void> {
  const rows = await listOutboxMutationsForDomain(username, NOTES_DOMAIN);
  for (const row of rows) {
    if (notesOutboxNoteId(row) === noteId) {
      await removeOutboxMutation(username, row.id);
      continue;
    }
    if (row.op !== "upsert") continue;
    try {
      const payload = JSON.parse(row.payload) as NotesUpsertPayload;
      if (payload.noteId === noteId || payload.tempNoteId === noteId) {
        await removeOutboxMutation(username, row.id);
      }
    } catch {
      // ignore malformed payloads
    }
  }
}

/**
 * Coalesce pending metadata upserts for the same note. Merges **metadata fields
 * only** (latest tags/starred/notebook wins) — there is no whole-note
 * replacement, so a concurrent collab body edit can never be clobbered here.
 */
function mergeNoteUpsertPayloads(
  existing: NotesUpsertPayload,
  incoming: NotesUpsertPayload,
): NotesUpsertPayload {
  return {
    noteId: incoming.noteId,
    metadata: { ...existing.metadata, ...incoming.metadata },
    tempNoteId: incoming.tempNoteId ?? existing.tempNoteId,
  };
}

/** Merges pending upsert rows for the same note so flush sends one metadata-only payload. */
export async function enqueueCoalescedNoteUpdate(
  username: string,
  noteId: string,
  note: Note,
  baseUpdatedAt: string | undefined,
  tempNoteId?: string,
): Promise<void> {
  const metadata = extractNoteMetadata(note);
  await enqueueCoalescedOutboxUpdate<NotesUpsertPayload>({
    username,
    domain: NOTES_DOMAIN,
    op: "upsert",
    entityId: noteId,
    patch: { noteId, metadata, tempNoteId },
    ifInState: baseUpdatedAt,
    mergePatches: mergeNoteUpsertPayloads,
    entityIdFromRow: notesOutboxNoteId,
    buildUpdatePayload: (entityId, patch) => ({ ...patch, noteId: entityId }),
    readPatchFromPayload: (payload) => payload as NotesUpsertPayload,
  });
}

export function createTempNoteId(): string {
  return `local-${crypto.randomUUID().replace(/-/g, "")}`;
}

export function isLocalTempNoteId(id: string | undefined): boolean {
  return !!id?.startsWith("local-");
}

export function noteUpdatedAtMs(value: string | undefined): number {
  if (!value || value === "—") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
