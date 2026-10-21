import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { Note } from "@/lib/models/note";
import { noteAfterNotebookMove } from "@/notes-core/src/notes-note-utils";
import { rememberOfflineNotesUsername } from "@/lib/offline/offline-session";
import type { EntityTable } from "dexie";
import {
  offlineAccountKeyFromUsername,
  offlineDbForAccount,
  type WgwOfflineDatabase,
} from "@/lib/offline/core/offline-db";
import { enqueueCoalescedOutboxUpdate } from "@/lib/offline/core/outbox-coalescing";
import {
  isSyncNoticeOutboxRow,
  listOutboxMutationsForDomain,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  isLocalTempNoteId,
  NOTES_DOMAIN,
  notesNotebooksTable,
  notesNotesTable,
  type OfflineNotebookRow,
  type OfflineNoteRow,
} from "@/lib/offline/notes/notes-schema";
import {
  adoptedNoteIdFor,
  readAndPruneAdoptedNoteIds,
} from "@/lib/offline/notes/notes-adopted-ids";
import {
  hasTagDelta,
  mergeNoteTagDeltas,
  type NoteTagDelta,
} from "@/lib/offline/notes/notes-tag-delta";
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
  /** REST collection id. Preferred over `notebook` when resolving the target. */
  notebookId?: string;
  title?: string;
  /** Full replace. Absent when this write is a tag delta or leaves tags alone. */
  tags?: string[];
  tagsAdd?: string[];
  tagsRemove?: string[];
  starred?: boolean;
  archived?: boolean;
  /** Present when the note lives under a group notebook. */
  groupSlug?: string | null;
};

/** Which cached fields a metadata PATCH is allowed to send. */
export type NoteMetadataSelection = {
  includeTitle?: boolean;
  includeTags?: boolean;
  /** True only when this write changes the star. */
  includeStarred?: boolean;
  /** True only when this write moves the note to another notebook. */
  includeNotebook?: boolean;
};

/** Fields this outbox row actually changes. Not inferred from metadata keys. */
export type NotePendingField = "title" | "tags" | "starred" | "archived" | "notebook" | "delete";

const NOTE_PENDING_FIELDS: readonly NotePendingField[] = [
  "title",
  "tags",
  "starred",
  "archived",
  "notebook",
  "delete",
];

export type NotesUpsertPayload = {
  noteId: string;
  metadata: NoteUpsertMetadata;
  tempNoteId?: string;
  /** Real changes in this write. Unioned when two upserts coalesce. */
  fields?: NotePendingField[];
  /**
   * False when this write's selection left the notebook off the PATCH.
   * Absent on a legacy snapshot, which still sends the notebook name.
   */
  patchNotebook?: boolean;
};

/** Pull only the outbox-tracked metadata fields off a note (drops body/excerpt). */
export function extractNoteMetadata(
  note: Note,
  selection?: NoteMetadataSelection,
): NoteUpsertMetadata {
  const includeTags = selection ? selection.includeTags === true : true;
  const includeTitle = selection ? selection.includeTitle === true : note.title !== undefined;
  const includeStarred = selection ? selection.includeStarred === true : note.starred !== undefined;
  return {
    notebook: note.notebook,
    ...(note.notebookId ? { notebookId: note.notebookId } : {}),
    ...(includeTitle && note.title !== undefined ? { title: note.title } : {}),
    ...(includeTags ? { tags: note.tags } : {}),
    ...(includeStarred && note.starred !== undefined ? { starred: note.starred } : {}),
    ...(note.archived !== undefined ? { archived: note.archived } : {}),
    ...(note.scope === "group" && note.groupSlug?.trim()
      ? { groupSlug: note.groupSlug.trim() }
      : {}),
  };
}

function metaKeyForNotebookState(notebook: string): string {
  return `notes:notebook:${notebook}:state`;
}

/** The note in a cache row, or null when the row is missing or unreadable. */
export function noteFromRow(row: OfflineNoteRow | undefined): Note | null {
  if (!row) return null;
  try {
    return JSON.parse(row.data) as Note;
  } catch {
    return null;
  }
}

export function noteRow(note: Note, pendingSync: boolean): OfflineNoteRow {
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

function collectionsForCache(
  collections: readonly NotesNotebookCollection[],
  notebookNames: readonly string[],
): NotesNotebookCollection[] {
  const seen = new Set<string>();
  for (const collection of collections) {
    seen.add(collection.id);
    seen.add(collection.name);
  }
  const extras = notebookNames
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

/** Cached notebook list: the meta list (or the rows), plus any row it lacks. */
async function readCachedCollections(db: WgwOfflineDatabase): Promise<NotesNotebookCollection[]> {
  const fromRows = (await notesNotebooksTable(db).toArray()).map(parseNotebookCacheRow);
  const collectionsRow = await db.meta.get(META_NOTEBOOK_COLLECTIONS);
  const fromMeta = collectionsRow?.value
    ? (JSON.parse(collectionsRow.value) as NotesNotebookCollection[])
    : undefined;
  return collectionsForCache(
    fromMeta && fromMeta.length > 0 ? fromMeta : fromRows,
    fromRows.map((item) => item.name),
  );
}

async function writeCachedCollections(
  db: WgwOfflineDatabase,
  collections: readonly NotesNotebookCollection[],
): Promise<void> {
  await db.meta.put({ key: META_NOTEBOOK_COLLECTIONS, value: JSON.stringify(collections) });
}

/** Rewrite the cached notes `map` changes. Other rows are not touched. */
async function rewriteCachedNotes(
  notes: EntityTable<OfflineNoteRow, "id">,
  map: (note: Note) => Note,
): Promise<void> {
  await notes.toCollection().modify((row) => {
    let note: Note;
    try {
      note = JSON.parse(row.data) as Note;
    } catch {
      return;
    }
    const next = map(note);
    if (next === note) return;
    row.data = JSON.stringify(next);
    // The index field holds the notebook name, as in noteRow.
    row.notebookId = next.notebook;
  });
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
  const notebookCollections = await readCachedCollections(db);
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

/**
 * Pending metadata must not wipe a server body that the local row never got
 * (common for pre-optimistic-sync historical notes → “Untitled note” in list).
 */
function pendingRowOverServer(row: OfflineNoteRow, server: Note | undefined): OfflineNoteRow {
  let pending: Note;
  try {
    pending = JSON.parse(row.data) as Note;
  } catch {
    return row;
  }
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
}

/**
 * Replace the cached bootstrap in one transaction, so a write that lands in
 * between cannot be cleared or put back. Adopted `local-*` ids are dropped:
 * nothing would ever sync them, and their server note is already cached.
 *
 * `takenAt` is when the snapshot was taken (epoch ms): when a live fetch was
 * sent, or when the cache was read. An adopted server note the snapshot lacks
 * is kept only when it was adopted at or after `takenAt`; the snapshot then
 * predates the create. Otherwise the snapshot wins: the note was deleted.
 */
export async function writeNotesBootstrapToCache(
  username: string,
  bootstrap: NotesAppBootstrap,
  takenAt: number,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const notes = notesNotesTable(db);
  const books = notesNotebooksTable(db);
  const collections = collectionsForCache(
    bootstrap.data.notebookCollections ?? [],
    bootstrap.data.notebooks ?? [],
  );
  rememberOfflineNotesUsername(username);
  await db.transaction("rw", [notes, books, db.meta], async () => {
    const adopted = await readAndPruneAdoptedNoteIds(db);
    const pendingRows = await notes
      .filter((row) => row.pendingSync && !adopted.has(row.id))
      .toArray();
    const snapshotIds = new Set(bootstrap.data.notes.map((note) => note.id));
    const newerThanSnapshot = [...adopted.values()]
      .filter(({ serverId, at }) => at >= takenAt && !snapshotIds.has(serverId))
      .map(({ serverId }) => serverId);
    // A pending server row (an early title) is not in adoptedRows; pendingRows keeps it.
    const adoptedRows = await notes.bulkGet([...new Set(newerThanSnapshot)]);
    await db.meta.put({ key: META_SESSION, value: JSON.stringify(bootstrap.session) });
    await writeCachedCollections(db, collections);
    if (bootstrap.data.groups !== undefined) {
      await db.meta.put({ key: META_GROUPS, value: JSON.stringify(bootstrap.data.groups) });
    }
    await books.clear();
    await books.bulkPut(
      collections.map((collection) => ({ id: collection.id, data: JSON.stringify(collection) })),
    );
    await notes.clear();
    const serverNotes = bootstrap.data.notes
      .filter((note) => !adopted.has(note.id))
      .map((note) => enrichNote(note));
    await notes.bulkPut(serverNotes.map((note) => noteRow(note, false)));
    await notes.bulkPut(
      adoptedRows.filter((row): row is OfflineNoteRow => row != null && !row.pendingSync),
    );
    const serverById = new Map(serverNotes.map((note) => [note.id, note]));
    await notes.bulkPut(
      pendingRows.map((row) => pendingRowOverServer(row, serverById.get(row.id))),
    );
  });
}

/** Skips a `local-*` id the server already adopted, so the temp row stays deleted. */
export async function upsertNoteInCache(
  username: string,
  note: Note,
  pendingSync = false,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const notes = notesNotesTable(db);
  if (!isLocalTempNoteId(note.id)) {
    await notes.put(noteRow(note, pendingSync));
    return;
  }
  await db.transaction("rw", [notes, db.meta], async () => {
    if (await adoptedNoteIdFor(db, note.id)) return;
    await notes.put(noteRow(note, pendingSync));
  });
}

/** One cached note, or null when the id is absent or the row is unreadable. */
export async function getNoteFromCache(username: string, noteId: string): Promise<Note | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return noteFromRow(await notesNotesTable(db).get(noteId));
}

/**
 * Update the Dexie list-preview body without touching metadata `pendingSync`.
 * Body is owned by the collab document — this must not stamp unsynced metadata.
 * Does not insert a missing row so remapped `local-*` ids stay deleted, and
 * drops a stale `local-*` row the server already adopted.
 */
export async function upsertNoteBodyPreviewInCache(username: string, note: Note): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = notesNotesTable(db);
  await db.transaction("rw", [table, db.meta], async () => {
    const existing = await table.get(note.id);
    if (!existing) return;
    if (isLocalTempNoteId(note.id) && (await adoptedNoteIdFor(db, note.id))) {
      await table.delete(note.id);
      return;
    }
    await table.put(noteRow(note, existing.pendingSync));
  });
}

/**
 * Cache a created or changed notebook. Only the notebook rows, the notebook
 * list and, on a rename, that notebook's notes are written, so a note another
 * writer saved meanwhile is not reverted.
 */
export async function upsertNotebookInCache(
  username: string,
  notebook: NotesNotebookCollection,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const books = notesNotebooksTable(db);
  const notes = notesNotesTable(db);
  await db.transaction("rw", [books, notes, db.meta], async () => {
    if (notebook.id !== notebook.name && (await books.get(notebook.name))) {
      await books.delete(notebook.name);
    }
    await books.put({ id: notebook.id, data: JSON.stringify(notebook) });
    if (!(await db.meta.get(META_SESSION))) return;
    const collections = await readCachedCollections(db);
    const previousName = collections.find((item) => item.id === notebook.id)?.name;
    await writeCachedCollections(db, mergeNotebookIntoList(collections, notebook));
    if (!previousName || previousName === notebook.name) return;
    const rename = { notebookId: notebook.id, fromName: previousName, toName: notebook.name };
    await rewriteCachedNotes(notes, (note) => notesWithRenamedNotebook([note], rename)[0] ?? note);
  });
}

/** Rename a notebook by name in the cache, without rewriting other notes. */
export async function renameNotebookInCache(
  username: string,
  from: string,
  to: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const books = notesNotebooksTable(db);
  const notes = notesNotesTable(db);
  await db.transaction("rw", [books, notes, db.meta], async () => {
    for (const row of await books.toArray()) {
      const collection = parseNotebookCacheRow(row);
      if (collection.name !== from) continue;
      await books.put({ id: row.id, data: JSON.stringify({ ...collection, name: to }) });
    }
    if (await db.meta.get(META_SESSION)) {
      const collections = await readCachedCollections(db);
      await writeCachedCollections(
        db,
        collections.map((item) => (item.name === from ? { ...item, name: to } : item)),
      );
    }
    await rewriteCachedNotes(notes, (note) =>
      note.notebook === from ? { ...note, notebook: to } : note,
    );
  });
}

function noteBelongsToNotebook(
  note: Note,
  notebookIdOrName: string,
  matchedIds: Set<string>,
  matchedNames: Set<string>,
): boolean {
  return (
    matchedIds.has(note.notebookId ?? "") ||
    matchedNames.has(note.notebook) ||
    note.notebookId === notebookIdOrName ||
    note.notebook === notebookIdOrName
  );
}

/**
 * Drop a notebook from the cache, and move or drop its notes. Only the
 * notebook rows, the notebook list and that notebook's notes are written.
 */
export async function removeNotebookFromCache(
  username: string,
  notebookIdOrName: string,
  options?: {
    keepPendingNotes?: boolean;
    moveNotesTo?: {
      id: string;
      name: string;
      scope?: "personal" | "group";
      groupSlug?: string | null;
    };
  },
): Promise<void> {
  const keepPending = options?.keepPendingNotes !== false;
  const moveNotesTo = options?.moveNotesTo;
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const books = notesNotebooksTable(db);
  const notes = notesNotesTable(db);
  await db.transaction("rw", [books, notes, db.meta], async () => {
    const matchedIds = new Set<string>([notebookIdOrName]);
    const matchedNames = new Set<string>([notebookIdOrName]);
    for (const row of await books.toArray()) {
      const collection = parseNotebookCacheRow(row);
      if (collection.id === notebookIdOrName || collection.name === notebookIdOrName) {
        matchedIds.add(collection.id);
        matchedNames.add(collection.name);
        await books.delete(row.id);
      }
    }
    for (const row of await notes.toArray()) {
      const note = noteFromRow(row);
      if (!note || !noteBelongsToNotebook(note, notebookIdOrName, matchedIds, matchedNames)) {
        continue;
      }
      if (moveNotesTo) {
        await notes.put(noteRow(noteAfterNotebookMove(note, moveNotesTo), row.pendingSync));
        continue;
      }
      if (keepPending && row.pendingSync) continue;
      await notes.delete(row.id);
    }
    if (moveNotesTo) {
      await db.meta.delete(metaKeyForNotebookState(moveNotesTo.id));
      for (const id of matchedIds) {
        await db.meta.delete(metaKeyForNotebookState(id));
      }
    }
    if (!(await db.meta.get(META_SESSION))) return;
    const collections = await readCachedCollections(db);
    await writeCachedCollections(
      db,
      collections.filter((item) => !matchedIds.has(item.id) && !matchedNames.has(item.name)),
    );
  });
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
  return rows.filter(isSyncNoticeOutboxRow);
}

export async function listPendingNoteIds(username: string): Promise<string[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await notesNotesTable(db)
    .filter((row) => row.pendingSync)
    .toArray();
  return rows.map((row) => row.id);
}

function isNotePendingField(value: unknown): value is NotePendingField {
  return typeof value === "string" && (NOTE_PENDING_FIELDS as readonly string[]).includes(value);
}

/** Fields the outbox recorded at enqueue time, so an inbound change to any
 *  other field can still be ingested (#1351). Key presence is not a change. */
export async function listPendingNoteFields(
  username: string,
): Promise<Map<string, Set<NotePendingField>>> {
  const rows = await listOutboxMutationsForDomain(username, NOTES_DOMAIN);
  const out = new Map<string, Set<NotePendingField>>();
  for (const row of rows) {
    let payload: { noteId?: unknown; fields?: unknown } | null = null;
    try {
      payload = JSON.parse(row.payload) as { noteId?: unknown; fields?: unknown };
    } catch {
      continue;
    }
    const noteId = typeof payload?.noteId === "string" ? payload.noteId : null;
    if (!noteId) continue;
    const fields = out.get(noteId) ?? new Set<NotePendingField>();
    if (row.op === "archive" || row.op === "restore") fields.add("archived");
    if (row.op === "delete") fields.add("delete");
    if (Array.isArray(payload?.fields)) {
      for (const field of payload.fields) {
        if (isNotePendingField(field)) fields.add(field);
      }
    }
    out.set(noteId, fields);
  }
  return out;
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

/** Note ids with any outbox row, including a non-retryable `stateMismatch`. */
export async function listOutboxNoteIds(username: string): Promise<Set<string>> {
  const rows = await listOutboxMutationsForDomain(username, NOTES_DOMAIN);
  const ids = new Set<string>();
  for (const row of rows) {
    const noteId = notesOutboxNoteId(row);
    if (noteId) ids.add(noteId);
  }
  return ids;
}

/**
 * Note ids whose outbox still has a retryable row. A `stateMismatch` row stays
 * queued but must not pin a notebook sync token until `cannotCalculateChanges`.
 */
export async function listNoteIdsBlockingSyncToken(username: string): Promise<Set<string>> {
  const rows = await listOutboxMutationsForDomain(username, NOTES_DOMAIN);
  const blocking = new Set<string>();
  for (const row of rows) {
    if (row.lastError === "stateMismatch") continue;
    const noteId = notesOutboxNoteId(row);
    if (noteId) blocking.add(noteId);
  }
  return blocking;
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

function metadataWithTagDelta(
  metadata: NoteUpsertMetadata,
  tagDelta: NoteTagDelta,
): NoteUpsertMetadata {
  const merged = mergeNoteTagDeltas({}, tagDelta);
  if (!hasTagDelta(merged)) return metadata;
  const { tags: _tags, ...rest } = metadata;
  return { ...rest, ...merged };
}

/**
 * Coalesce pending metadata upserts for the same note. Tag deltas union;
 * other metadata fields still take the latest value. There is no whole-note
 * replacement, so a concurrent collab body edit can never be clobbered here.
 */
function mergeNoteUpsertPayloads(
  existing: NotesUpsertPayload,
  incoming: NotesUpsertPayload,
): NotesUpsertPayload {
  const metadata: NoteUpsertMetadata = { ...existing.metadata, ...incoming.metadata };
  if (hasTagDelta(existing.metadata) || hasTagDelta(incoming.metadata)) {
    const merged = mergeNoteTagDeltas(existing.metadata, incoming.metadata);
    delete metadata.tags;
    delete metadata.tagsAdd;
    delete metadata.tagsRemove;
    Object.assign(metadata, merged);
  }
  const fields = [
    ...new Set<NotePendingField>([...(existing.fields ?? []), ...(incoming.fields ?? [])]),
  ];
  const patchNotebook = mergedPatchNotebook(existing.patchNotebook, incoming.patchNotebook);
  return {
    noteId: incoming.noteId,
    metadata,
    tempNoteId: incoming.tempNoteId ?? existing.tempNoteId,
    ...(fields.length > 0 ? { fields } : {}),
    ...(patchNotebook !== undefined ? { patchNotebook } : {}),
  };
}

function mergedPatchNotebook(
  existing: boolean | undefined,
  incoming: boolean | undefined,
): boolean | undefined {
  if (existing === true || incoming === true) return true;
  if (existing === false || incoming === false) return false;
  return undefined;
}

function fieldsForUpsert(
  selection: NoteMetadataSelection | undefined,
  tagDelta: NoteTagDelta | undefined,
): NotePendingField[] {
  const fields = new Set<NotePendingField>();
  const includeTitle = selection ? selection.includeTitle === true : true;
  const includeTags = selection ? selection.includeTags === true : true;
  if (includeTitle) fields.add("title");
  if (includeTags || hasTagDelta(tagDelta ?? {})) fields.add("tags");
  if (selection?.includeStarred) fields.add("starred");
  if (selection?.includeNotebook) fields.add("notebook");
  return [...fields];
}

/** Merges pending upsert rows for the same note so flush sends one metadata-only payload. */
export async function enqueueCoalescedNoteUpdate(
  username: string,
  noteId: string,
  note: Note,
  baseUpdatedAt: string | undefined,
  tempNoteId?: string,
  tagDelta?: NoteTagDelta,
  selection?: NoteMetadataSelection,
): Promise<void> {
  const metadata = tagDelta
    ? metadataWithTagDelta(extractNoteMetadata(note, selection), tagDelta)
    : extractNoteMetadata(note, selection);
  const fields = fieldsForUpsert(selection, tagDelta);
  await enqueueCoalescedOutboxUpdate<NotesUpsertPayload>({
    username,
    domain: NOTES_DOMAIN,
    op: "upsert",
    entityId: noteId,
    patch: {
      noteId,
      metadata,
      tempNoteId,
      ...(fields.length > 0 ? { fields } : {}),
      ...(selection ? { patchNotebook: selection.includeNotebook === true } : {}),
    },
    ifInState: baseUpdatedAt,
    mergePatches: mergeNoteUpsertPayloads,
    entityIdFromRow: notesOutboxNoteId,
    buildUpdatePayload: (entityId, patch) => ({ ...patch, noteId: entityId }),
    readPatchFromPayload: (payload) => payload as NotesUpsertPayload,
  });
}

export function noteUpdatedAtMs(value: string | undefined): number {
  if (!value || value === "—") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
