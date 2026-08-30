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
  type OfflineNotebookRow,
  type OfflineNoteRow,
} from "@/lib/offline/notes/notes-schema";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import {
  enrichNote,
  noteHasListableBody,
  notesWithRenamedNotebook,
} from "@/notes-core/src/notes-note-utils";

export {
  enqueueOutboxMutation,
  listOutboxMutations,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";

const META_SESSION = "notes:session";
const META_NOTEBOOK_COLLECTIONS = "notes:notebookCollections";
const META_GROUPS = "notes:groups";

/**
 * Frontmatter metadata coalesced through the Notes outbox. The note **body** is
 * intentionally excluded — body lives in the Docs Yjs collab document and is
 * never sent through the Notes metadata API.
 */
export type NoteUpsertMetadata = {
  notebook: string;
  title?: string;
  tags: string[];
  starred?: boolean;
  archived?: boolean;
  /** Present when the note lives under a group notebook. */
  groupSlug?: string | null;
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
    ...(note.title !== undefined ? { title: note.title } : {}),
    tags: note.tags,
    ...(note.starred !== undefined ? { starred: note.starred } : {}),
    ...(note.archived !== undefined ? { archived: note.archived } : {}),
    ...(note.scope === "group" && note.groupSlug?.trim()
      ? { groupSlug: note.groupSlug.trim() }
      : {}),
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

function isOwnedPersonalNotebook(notebook: NotesNotebookCollection): boolean {
  return notebook.isSharee !== true && notebook.scope !== "group";
}

export function parseNotebookCacheRow(row: OfflineNotebookRow): NotesNotebookCollection {
  try {
    const parsed = JSON.parse(row.data) as unknown;
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      const name = typeof rec.name === "string" && rec.name.trim() ? rec.name : row.id;
      return {
        ...(rec as NotesNotebookCollection),
        id: typeof rec.id === "string" && rec.id.trim() ? rec.id : row.id,
        name,
      };
    }
  } catch {
    // Name-only rows from older Dexie writes still hydrate.
  }
  return { id: row.id, name: row.id };
}

function collectionsForCache(bootstrap: NotesAppBootstrap): NotesNotebookCollection[] {
  const collections = bootstrap.data.notebookCollections ?? [];
  const seen = new Set<string>();
  for (const collection of collections) {
    seen.add(collection.id);
    seen.add(collection.name);
  }
  const extras = (bootstrap.data.notebooks ?? [])
    .filter((name) => !seen.has(name))
    .map((name): NotesNotebookCollection => ({ id: name, name }));
  return [...collections, ...extras];
}

function mergeNotebookIntoList(
  collections: NotesNotebookCollection[],
  notebook: NotesNotebookCollection,
): NotesNotebookCollection[] {
  const index = collections.findIndex(
    (item) => item.id === notebook.id || item.name === notebook.name,
  );
  if (index === -1) return [...collections, notebook];
  return collections.map((item, i) => (i === index ? { ...item, ...notebook } : item));
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
  const fromRows = books.map(parseNotebookCacheRow);
  const collectionsRow = await db.meta.get(META_NOTEBOOK_COLLECTIONS);
  const fromMeta = collectionsRow?.value
    ? (JSON.parse(collectionsRow.value) as NotesNotebookCollection[])
    : undefined;
  const notebookCollections = collectionsForCache({
    session,
    data: {
      notes: [],
      notebooks: fromRows.map((item) => item.name),
      tags: [],
      notebookCollections: fromMeta && fromMeta.length > 0 ? fromMeta : fromRows,
    },
  });
  const notebooks = [
    ...new Set(notebookCollections.filter(isOwnedPersonalNotebook).map((item) => item.name)),
  ];
  const noteEntities = notes.map((row) => JSON.parse(row.data) as Note);
  const groupsRow = await db.meta.get(META_GROUPS);
  const groups = groupsRow?.value
    ? (JSON.parse(groupsRow.value) as NotesAppBootstrap["data"]["groups"])
    : undefined;

  return {
    session,
    data: {
      notes: noteEntities,
      notebooks,
      notebookCollections,
      tags: tagsFromNotes(noteEntities),
      ...(groups ? { groups } : {}),
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
  const collections = collectionsForCache(bootstrap);
  await db.meta.put({
    key: META_NOTEBOOK_COLLECTIONS,
    value: JSON.stringify(collections),
  });
  if (bootstrap.data.groups !== undefined) {
    await db.meta.put({
      key: META_GROUPS,
      value: JSON.stringify(bootstrap.data.groups),
    });
  }
  rememberOfflineNotesUsername(username);
  await books.clear();
  await books.bulkPut(
    collections.map((collection) => ({
      id: collection.id,
      data: JSON.stringify(collection),
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

export async function upsertNotebookInCache(
  username: string,
  notebook: NotesNotebookCollection,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const books = notesNotebooksTable(db);
  if (notebook.id !== notebook.name) {
    const byName = await books.get(notebook.name);
    if (byName) await books.delete(notebook.name);
  }
  await books.put({
    id: notebook.id,
    data: JSON.stringify(notebook),
  });
  const cached = await readNotesBootstrapFromCache(username);
  if (!cached) return;
  const previous = (cached.data.notebookCollections ?? []).find((item) => item.id === notebook.id);
  const previousName = previous?.name;
  cached.data.notebookCollections = mergeNotebookIntoList(
    cached.data.notebookCollections ?? [],
    notebook,
  );
  if (previousName && previousName !== notebook.name) {
    cached.data.notes = notesWithRenamedNotebook(cached.data.notes, {
      notebookId: notebook.id,
      fromName: previousName,
      toName: notebook.name,
    });
    cached.data.notebooks = cached.data.notebooks.map((name) =>
      name === previousName ? notebook.name : name,
    );
  } else if (isOwnedPersonalNotebook(notebook) && !cached.data.notebooks.includes(notebook.name)) {
    cached.data.notebooks = [...cached.data.notebooks, notebook.name];
  }
  await writeNotesBootstrapToCache(username, cached);
}

export async function removeNotebookFromCache(
  username: string,
  notebookIdOrName: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const books = notesNotebooksTable(db);
  const rows = await books.toArray();
  for (const row of rows) {
    const collection = parseNotebookCacheRow(row);
    if (collection.id === notebookIdOrName || collection.name === notebookIdOrName) {
      await books.delete(row.id);
    }
  }
  const cached = await readNotesBootstrapFromCache(username);
  if (!cached) return;
  cached.data.notebookCollections = (cached.data.notebookCollections ?? []).filter(
    (item) => item.id !== notebookIdOrName && item.name !== notebookIdOrName,
  );
  cached.data.notebooks = cached.data.notebooks.filter((name) => name !== notebookIdOrName);
  await writeNotesBootstrapToCache(username, cached);
}

export async function removeNoteFromCache(username: string, noteId: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await notesNotesTable(db).delete(noteId);
}

/**
 * Drop Dexie + outbox for a note the server reported as gone (HTTP 404).
 * Callers must only invoke this after a 404 persist error — not 403/412/5xx.
 */
export async function dropLocalNoteAfterServerGone(
  username: string,
  noteId: string,
): Promise<void> {
  await removeOutboxMutationsForNote(username, noteId);
  await removeNoteFromCache(username, noteId);
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
