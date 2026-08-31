import type { Note } from "@/lib/models/note";
import type {
  DeleteNotebookAction,
  NotesAPIOperations,
  NotesNotebookCollection,
} from "@/notes-core/src/notes-types";
import {
  backfillNotesContentFromServer,
  preserveLocalListableBodiesOnServerNotes,
} from "@/notes-core/src/notes-note-utils";
import { enrichNotesListPreviewsFromCollabOffline } from "@/lib/offline/notes/notes-list-preview-enrich";
import {
  archiveNoteItem,
  createNoteItem,
  createNotebook as createNotebookApi,
  patchNotebookCollection as patchNotebookApi,
  deleteNotebook as deleteNotebookApi,
  deleteNoteItem,
  fetchNotesLiveBootstrap,
  renameNotebook as renameNotebookApi,
  restoreNoteItem,
  updateNoteItem,
  wgwNoteMetadataFromNote,
  wgwNoteUpsertFromNote,
} from "@/lib/api/wgw/notes";
import {
  getConnectivitySnapshot,
  isFetchNetworkError,
  readBrowserOnline,
} from "@/lib/offline/core/browser-online";
import {
  createTempNoteId,
  dropLocalNoteAfterServerGone,
  isLocalTempNoteId,
  enqueueCoalescedNoteUpdate,
  enqueueOutboxMutation,
  listOutboxMutations,
  listPendingNoteIds,
  notesOutboxNoteId,
  readNotesBootstrapFromCache,
  removeNoteFromCache,
  removeNotebookFromCache,
  removeOutboxMutationsForNote,
  upsertNoteInCache,
  upsertNotebookInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { isNotesPersistGone, persistHttpStatus } from "@/notes-core/src/notes-persist-access";
import { migrateNoteCollabPersistenceAfterIdRemap } from "@/lib/offline/notes/notes-collab-persistence-migrate";
import { NOTES_DOMAIN, notesNotesTable } from "@/lib/offline/notes/notes-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { flushNotesOutbox, type OutboxFlushResult } from "@/lib/offline/notes-outbox-flush";
import { reportNotesSyncConflicts } from "@/lib/offline/notes-sync-conflicts";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";

function rethrowUnlessOfflineQueue(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw error;
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (!isFetchNetworkError(error)) throw error;
}

/**
 * Queue instead of failing the write. Auth stays thrown. local-* creates that
 * 400/422/5xx must enqueue so Dexie is not pending without an outbox.
 */
function shouldQueueNotesUpsert(
  error: unknown,
  note: Pick<Note, "id">,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted) return false;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const status = persistHttpStatus(error);
  if (status === 401 || status === 403) return false;
  if (isLocalTempNoteId(note.id)) return true;
  if (status === 412) return true;
  return status != null && status >= 500;
}

async function isNeverSyncedPendingNote(username: string, noteId: string): Promise<boolean> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await notesNotesTable(db).get(noteId);
  return row?.pendingSync === true;
}

/**
 * On 404, the server object is gone — drop Dexie/outbox so the note cannot linger
 * as a zombie you cannot archive. 403/401/412/5xx must not delete local.
 */
async function dropLocalIfServerGone(
  username: string,
  noteId: string,
  error: unknown,
): Promise<boolean> {
  if (!isNotesPersistGone(error)) return false;
  await dropLocalNoteAfterServerGone(username, noteId);
  return true;
}

async function renameCachedNotebook(username: string, from: string, to: string): Promise<void> {
  const cached = await readNotesBootstrapFromCache(username);
  if (!cached) return;
  cached.data.notebooks = cached.data.notebooks.map((name) => (name === from ? to : name));
  cached.data.notebookCollections = (cached.data.notebookCollections ?? []).map((item) =>
    item.name === from ? { ...item, name: to } : item,
  );
  cached.data.notes = cached.data.notes.map((note) =>
    note.notebook === from ? { ...note, notebook: to } : note,
  );
  await writeNotesBootstrapToCache(username, cached);
}

function notebookDeleteBodyForAction(action: DeleteNotebookAction): {
  mode: "archive" | "move" | "purge";
  target?: string;
} {
  if (action.kind === "archive") return { mode: "archive" };
  if (action.kind === "purge") return { mode: "purge" };
  return { mode: "move", target: action.target };
}

function baseUpdatedAt(note: Note): string | undefined {
  if (note.etag) return note.etag;
  if (note.updatedAt) return note.updatedAt;
  return note.date !== "—" ? note.date : undefined;
}

function applyNoteUpdate(existing: Note, patch: Note): Note {
  const { etag: patchEtag, ...rest } = patch;
  return {
    ...existing,
    ...rest,
    ...(patchEtag ? { etag: patchEtag } : {}),
  };
}

const noteMetadataWriteChains = new Map<string, Promise<unknown>>();

function enqueueNoteMetadataWrite<T>(noteId: string, write: () => Promise<T>): Promise<T> {
  const previous = noteMetadataWriteChains.get(noteId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(write);
  noteMetadataWriteChains.set(noteId, next);
  return next;
}

function tempNoteIdForCreate(existing: Note | undefined, note: Note): string | undefined {
  if (existing) return undefined;
  if (isLocalTempNoteId(note.id)) return note.id;
  if (note.id?.trim()) return undefined;
  return createTempNoteId();
}

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<OutboxFlushResult>();

async function flushNotesOutboxAndReport(username: string): Promise<OutboxFlushResult> {
  const result = await flushNotesOutbox(username);
  reportNotesSyncConflicts(result.stateMismatches);
  return result;
}

function runnerFor(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return syncRunnerRegistry.getOrCreate(username, async () => flushNotesOutboxAndReport(username));
}

async function resolveCachedNote(
  username: string,
  noteId: string,
  _signal?: AbortSignal,
): Promise<Note | undefined> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await notesNotesTable(db).get(noteId);
  if (row) {
    return JSON.parse(row.data) as Note;
  }

  const cached = await readNotesBootstrapFromCache(username);
  const fromCache = cached?.data.notes.find((n) => n.id === noteId);
  if (fromCache || !readBrowserOnline()) return fromCache;

  try {
    const bootstrap = await fetchNotesLiveBootstrap();
    return bootstrap.data.notes.find((n) => n.id === noteId);
  } catch (error) {
    if (isFetchNetworkError(error)) return fromCache;
    throw error;
  }
}

async function queueOfflineUpsert(
  username: string,
  note: Note,
  tempNoteId?: string,
): Promise<Note> {
  await upsertNoteInCache(username, note, true);
  await enqueueCoalescedNoteUpdate(username, note.id, note, baseUpdatedAt(note), tempNoteId);
  return note;
}

/** Heal pending local-* rows that have no outbox so flush can POST them. */
async function enqueueOrphanPendingLocalCreates(username: string): Promise<void> {
  const pendingIds = await listPendingNoteIds(username);
  if (pendingIds.length === 0) return;
  const queued = new Set(
    (await listOutboxMutations(username))
      .map((row) => notesOutboxNoteId(row))
      .filter((id): id is string => !!id),
  );
  for (const id of pendingIds) {
    if (!isLocalTempNoteId(id) || queued.has(id)) continue;
    const note = await resolveCachedNote(username, id);
    if (!note) continue;
    await enqueueCoalescedNoteUpdate(username, note.id, note, baseUpdatedAt(note), note.id);
  }
}

async function queueOfflineDelete(
  username: string,
  note: Pick<Note, "id" | "notebook" | "archived" | "groupSlug" | "scope" | "etag">,
): Promise<void> {
  await removeOutboxMutationsForNote(username, note.id);
  await removeNoteFromCache(username, note.id);
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: NOTES_DOMAIN,
    op: "delete",
    payload: JSON.stringify({
      noteId: note.id,
      notebook: note.notebook,
      archived: !!note.archived,
      ...(note.etag ? { etag: note.etag } : {}),
      ...(note.scope === "group" && note.groupSlug?.trim()
        ? { groupSlug: note.groupSlug.trim() }
        : {}),
    }),
  });
}

type NoteDeleteTarget = Pick<Note, "id" | "notebook" | "archived" | "groupSlug" | "scope" | "etag">;

async function resolveDeleteTarget(
  username: string,
  note: Pick<Note, "id" | "notebook" | "archived" | "groupSlug" | "scope" | "etag">,
): Promise<NoteDeleteTarget> {
  const cached = note.id ? await resolveCachedNote(username, note.id) : undefined;
  if (cached) {
    return {
      id: note.id,
      notebook: cached.notebook,
      archived: cached.archived ?? note.archived ?? false,
      scope: cached.scope ?? note.scope,
      groupSlug: cached.groupSlug ?? note.groupSlug,
      ...(cached.etag || note.etag ? { etag: cached.etag ?? note.etag } : {}),
    };
  }
  return {
    id: note.id,
    notebook: note.notebook,
    archived: !!note.archived,
    scope: note.scope,
    groupSlug: note.groupSlug,
    ...(note.etag ? { etag: note.etag } : {}),
  };
}

function deleteNoteItemBody(target: NoteDeleteTarget): {
  notebook: string;
  archived: boolean;
  groupSlug?: string;
  etag?: string;
} {
  return {
    notebook: target.notebook,
    archived: !!target.archived,
    ...(target.scope === "group" && target.groupSlug?.trim()
      ? { groupSlug: target.groupSlug.trim() }
      : {}),
    ...(target.etag ? { etag: target.etag } : {}),
  };
}

/** Drop the client temp row and move the UID collab room onto the server-minted id. */
async function adoptServerCreatedNote(
  username: string,
  localId: string,
  saved: Note,
): Promise<void> {
  if (localId && localId !== saved.id) {
    await migrateNoteCollabPersistenceAfterIdRemap({
      username,
      notebook: saved.notebook,
      tempNoteId: localId,
      savedNoteId: saved.id,
      archived: saved.archived,
    });
    await removeNoteFromCache(username, localId);
  }
  await upsertNoteInCache(username, saved, false);
}

function groupSlugOpts(
  note: Pick<Note, "scope" | "groupSlug"> | undefined,
  opts?: { signal?: AbortSignal },
): { signal?: AbortSignal; groupSlug?: string } | undefined {
  const slug =
    note?.scope === "group" && note.groupSlug?.trim() ? note.groupSlug.trim() : undefined;
  if (!slug && !opts?.signal) return undefined;
  return {
    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
    ...(slug ? { groupSlug: slug } : {}),
  };
}

async function createLocalTempNoteOnline(
  username: string,
  note: Note,
  runner: ConnectivitySyncRunner<OutboxFlushResult>,
  opts?: { signal?: AbortSignal },
): Promise<Note> {
  const saved = await createNoteItem(
    wgwNoteUpsertFromNote(note, { starred: !!note.starred, archived: !!note.archived }),
    opts,
  );
  if (isLocalTempNoteId(saved.id)) {
    return queueOfflineUpsert(username, { ...saved, id: note.id }, note.id);
  }
  await adoptServerCreatedNote(username, note.id, saved);
  await runner.flush();
  return saved;
}

async function upsertNoteOnline(
  username: string,
  note: Note,
  runner: ConnectivitySyncRunner<OutboxFlushResult>,
  opts?: { signal?: AbortSignal },
): Promise<Note> {
  if (isLocalTempNoteId(note.id)) {
    return createLocalTempNoteOnline(username, note, runner, opts);
  }
  const metadataRequest = wgwNoteMetadataFromNote(note, {
    starred: !!note.starred,
    archived: !!note.archived,
  });
  try {
    const saved = await updateNoteItem(note.id, metadataRequest, opts);
    await upsertNoteInCache(username, saved, false);
    await runner.flush();
    return saved;
  } catch (error) {
    const status = persistHttpStatus(error);
    if (status === 412) {
      const saved = await updateNoteItem(note.id, { ...metadataRequest, etag: undefined }, opts);
      await upsertNoteInCache(username, saved, false);
      await runner.flush();
      return saved;
    }
    if (status !== 404) throw error;
    if (await isNeverSyncedPendingNote(username, note.id)) {
      return queueOfflineUpsert(username, note, tempNoteIdForCreate(undefined, note));
    }
    await dropLocalNoteAfterServerGone(username, note.id);
    throw error;
  }
}

export function createHybridNotesOperations(username: string): NotesAPIOperations {
  const runner = runnerFor(username);

  return {
    upsertNote: async (note, opts) => {
      const existing = note.id
        ? await resolveCachedNote(username, note.id, opts?.signal)
        : undefined;
      const merged = existing ? applyNoteUpdate(existing, note) : note;
      if (!readBrowserOnline()) {
        const tempId = tempNoteIdForCreate(existing, merged);
        const optimistic = tempId ? { ...merged, id: tempId } : merged;
        return queueOfflineUpsert(username, optimistic, tempId);
      }
      try {
        return await enqueueNoteMetadataWrite(merged.id, () =>
          upsertNoteOnline(username, merged, runner, opts),
        );
      } catch (error) {
        if (!shouldQueueNotesUpsert(error, merged, opts?.signal)) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
        const tempId = tempNoteIdForCreate(existing, merged);
        const optimistic = tempId ? { ...merged, id: tempId } : merged;
        return queueOfflineUpsert(username, optimistic, tempId);
      }
    },
    deleteNote: async (note, opts) => {
      const target = await resolveDeleteTarget(username, note);
      await removeOutboxMutationsForNote(username, target.id);
      if (!getConnectivitySnapshot()) {
        await queueOfflineDelete(username, target);
        return;
      }
      try {
        await deleteNoteItem(target.id, deleteNoteItemBody(target), opts);
        await removeNoteFromCache(username, target.id);
        await runner.flush();
      } catch (error) {
        if (await dropLocalIfServerGone(username, target.id, error)) return;
        rethrowUnlessOfflineQueue(error, opts?.signal);
        await queueOfflineDelete(username, target);
      }
    },
    archiveNote: async (id, opts) => {
      const existing = await resolveCachedNote(username, id, opts?.signal);
      if (!existing) {
        throw new Error(
          !readBrowserOnline() ? "Note not found in cache while offline" : "Note not found",
        );
      }
      const groupSlug =
        existing.scope === "group" && existing.groupSlug?.trim()
          ? existing.groupSlug.trim()
          : undefined;
      if (!readBrowserOnline()) {
        const optimistic = { ...existing, archived: true };
        await upsertNoteInCache(username, optimistic, true);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "archive",
          payload: JSON.stringify({ noteId: id, ...(groupSlug ? { groupSlug } : {}) }),
        });
        return optimistic;
      }
      try {
        const saved = await archiveNoteItem(id, groupSlugOpts(existing, opts));
        await upsertNoteInCache(username, saved, false);
        await runner.flush();
        return saved;
      } catch (error) {
        if (await dropLocalIfServerGone(username, id, error)) throw error;
        rethrowUnlessOfflineQueue(error, opts?.signal);
        const optimistic = { ...existing, archived: true };
        await upsertNoteInCache(username, optimistic, true);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "archive",
          payload: JSON.stringify({ noteId: id, ...(groupSlug ? { groupSlug } : {}) }),
        });
        return optimistic;
      }
    },
    restoreNote: async (id, opts) => {
      const existing = await resolveCachedNote(username, id, opts?.signal);
      if (!existing) {
        throw new Error(
          !readBrowserOnline() ? "Note not found in cache while offline" : "Note not found",
        );
      }
      const groupSlug =
        existing.scope === "group" && existing.groupSlug?.trim()
          ? existing.groupSlug.trim()
          : undefined;
      if (!readBrowserOnline()) {
        const optimistic = { ...existing, archived: false };
        await upsertNoteInCache(username, optimistic, true);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "restore",
          payload: JSON.stringify({ noteId: id, ...(groupSlug ? { groupSlug } : {}) }),
        });
        return optimistic;
      }
      try {
        const saved = await restoreNoteItem(id, groupSlugOpts(existing, opts));
        await upsertNoteInCache(username, saved, false);
        await runner.flush();
        return saved;
      } catch (error) {
        if (await dropLocalIfServerGone(username, id, error)) throw error;
        rethrowUnlessOfflineQueue(error, opts?.signal);
        const optimistic = { ...existing, archived: false };
        await upsertNoteInCache(username, optimistic, true);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "restore",
          payload: JSON.stringify({ noteId: id, ...(groupSlug ? { groupSlug } : {}) }),
        });
        return optimistic;
      }
    },
    patchNotebook: async (notebookId, patch, opts) => {
      const updated = await patchNotebookApi(notebookId, patch, opts);
      await upsertNotebookInCache(username, updated);
      return updated;
    },
    createNotebook: async (name, opts) => {
      const local: NotesNotebookCollection = {
        id: name,
        name,
        color: opts?.color?.trim() || null,
        isSharee: false,
        scope: opts?.groupSlug?.trim() ? "group" : "personal",
        groupSlug: opts?.groupSlug?.trim() || null,
      };
      const outboxPayload = JSON.stringify({
        name,
        ...(local.color ? { color: local.color } : {}),
        ...(local.groupSlug ? { groupSlug: local.groupSlug } : {}),
      });
      if (!readBrowserOnline()) {
        await upsertNotebookInCache(username, local);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "createNotebook",
          payload: outboxPayload,
        });
        return local;
      }
      try {
        const created = await createNotebookApi(name, opts);
        await upsertNotebookInCache(username, created);
        await runner.flush();
        return created;
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        await upsertNotebookInCache(username, local);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "createNotebook",
          payload: outboxPayload,
        });
        return local;
      }
    },
    renameNotebook: async (from, to, opts) => {
      if (!readBrowserOnline()) {
        await renameCachedNotebook(username, from, to);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "renameNotebook",
          payload: JSON.stringify({ from, to }),
        });
        return;
      }
      try {
        await renameNotebookApi(from, to, opts);
        await renameCachedNotebook(username, from, to);
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        await renameCachedNotebook(username, from, to);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "renameNotebook",
          payload: JSON.stringify({ from, to }),
        });
      }
    },
    deleteNotebook: async (name, action, opts) => {
      if (!readBrowserOnline()) {
        await removeNotebookFromCache(username, name, { keepPendingNotes: false });
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "deleteNotebook",
          payload: JSON.stringify({ name, action }),
        });
        return;
      }
      try {
        await deleteNotebookApi(name, notebookDeleteBodyForAction(action), opts);
        await removeNotebookFromCache(username, name, { keepPendingNotes: false });
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        await removeNotebookFromCache(username, name, { keepPendingNotes: false });
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "deleteNotebook",
          payload: JSON.stringify({ name, action }),
        });
      }
    },
  };
}

export async function fetchNotesHybridBootstrap(): Promise<
  Awaited<ReturnType<typeof fetchNotesLiveBootstrap>>
> {
  const bootstrap = await fetchNotesLiveBootstrap();
  const username = bootstrap.session.user.username;
  if (!username) {
    throw new Error("Notes bootstrap missing username");
  }
  if (readBrowserOnline()) {
    await enqueueOrphanPendingLocalCreates(username);
  }
  const hadOutbox = readBrowserOnline() && (await listOutboxMutations(username)).length > 0;
  if (readBrowserOnline()) {
    await flushNotesOutboxAndReport(username);
  }
  const cached = await readNotesBootstrapFromCache(username);
  if (cached) {
    cached.session = bootstrap.session;
    // Live notebook list is source of truth, including empty (API omits deleted dirs).
    cached.data.notebooks = bootstrap.data.notebooks;
    cached.data.sharedNotebooks = bootstrap.data.sharedNotebooks ?? [];
    cached.data.notebookCollections = bootstrap.data.notebookCollections ?? [];
    cached.data.groups = bootstrap.data.groups ?? [];
    if (!hadOutbox) {
      // Server is source of truth for membership/metadata, but body lives in
      // collab — keep a non-empty cached preview when the API body is still empty.
      cached.data.notes = preserveLocalListableBodiesOnServerNotes(
        bootstrap.data.notes,
        cached.data.notes,
      );
      cached.data.tags = bootstrap.data.tags;
    } else {
      // Keep local/outbox rows, but backfill empty body/excerpt from the server
      // so historical list previews are not stuck on “Untitled note”.
      cached.data.notes = backfillNotesContentFromServer(cached.data.notes, bootstrap.data.notes);
      const localIds = new Set(cached.data.notes.map((n) => n.id));
      for (const note of bootstrap.data.notes) {
        if (note.sharedInbox && !localIds.has(note.id)) {
          cached.data.notes.push(note);
          localIds.add(note.id);
        }
      }
      cached.data.tags = [
        ...new Set([
          ...cached.data.tags,
          ...bootstrap.data.tags,
          ...cached.data.notes.flatMap((n) => n.tags),
        ]),
      ];
    }
    cached.data.notes = await enrichNotesListPreviewsFromCollabOffline(username, cached.data.notes);
    await writeNotesBootstrapToCache(username, cached);
    return cached;
  }
  bootstrap.data.notes = await enrichNotesListPreviewsFromCollabOffline(
    username,
    bootstrap.data.notes,
  );
  await writeNotesBootstrapToCache(username, bootstrap);
  return bootstrap;
}

export async function loadNotesBootstrapHybrid(): Promise<
  Awaited<ReturnType<typeof fetchNotesLiveBootstrap>>
> {
  if (!readBrowserOnline()) {
    const username = readOfflineNotesUsername();
    if (username) {
      const cached = await readNotesBootstrapFromCache(username);
      if (cached) {
        cached.data.notes = await enrichNotesListPreviewsFromCollabOffline(
          username,
          cached.data.notes,
        );
        return cached;
      }
    }
    throw new Error("No cached notes available offline");
  }

  return fetchNotesHybridBootstrap();
}

export function getNotesSyncRunner(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return runnerFor(username);
}
