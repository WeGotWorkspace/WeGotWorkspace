import type { Note } from "@/lib/models/note";
import type {
  NoteMetadataField,
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
  dropLocalNoteAfterServerGone,
  enqueueCoalescedNoteUpdate,
  enqueueOutboxMutation,
  listOutboxMutations,
  readNotesBootstrapFromCache,
  removeNoteFromCache,
  removeNotebookFromCache,
  removeOutboxMutationsForNote,
  renameNotebookInCache,
  upsertNoteInCache,
  upsertNotebookInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { adoptServerNoteInCache, adoptedServerNoteId } from "@/lib/offline/notes-temp-adoption";
import { isNotesPersistGone, persistHttpStatus } from "@/notes-core/src/notes-persist-access";
import { migrateNoteCollabPersistenceAfterIdRemap } from "@/lib/offline/notes/notes-collab-persistence-migrate";
import {
  createTempNoteId,
  isLocalTempNoteId,
  NOTES_DOMAIN,
  notesNotesTable,
} from "@/lib/offline/notes/notes-schema";
import { enqueueOrphanPendingLocalCreates } from "@/lib/offline/notes/notes-orphan-heal";
import { clearCreateInFlight, markCreateInFlight } from "@/lib/offline/notes/notes-adopted-ids";
import {
  baseUpdatedAt,
  metadataSelection,
  noteFieldsPatch,
} from "@/lib/offline/notes/notes-metadata-selection";
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

function cachedMoveTarget(
  collections: readonly NotesNotebookCollection[] | undefined,
  target: string,
): {
  id: string;
  name: string;
  scope?: "personal" | "group";
  groupSlug?: string | null;
} {
  const match = collections?.find((item) => item.id === target || item.name === target);
  if (!match) return { id: target, name: target };
  return {
    id: match.id,
    name: match.name,
    ...(match.scope ? { scope: match.scope } : {}),
    ...(match.groupSlug !== undefined ? { groupSlug: match.groupSlug } : {}),
  };
}

function applyNoteUpdate(existing: Note, patch: Partial<Note>): Note {
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

type NoteUpsertOpts = Parameters<NotesAPIOperations["upsertNote"]>[1];

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
  // The server never has a local-* id: a cache miss is simply "not found".
  if (isLocalTempNoteId(noteId)) return undefined;

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

function tagDeltaFromOpts(opts?: {
  tagsAdd?: string[];
  tagsRemove?: string[];
}): { tagsAdd?: string[]; tagsRemove?: string[] } | undefined {
  if (!opts?.tagsAdd?.length && !opts?.tagsRemove?.length) return undefined;
  return {
    ...(opts.tagsAdd?.length ? { tagsAdd: opts.tagsAdd } : {}),
    ...(opts.tagsRemove?.length ? { tagsRemove: opts.tagsRemove } : {}),
  };
}

type QueuedUpsert = {
  tempNoteId?: string;
  tagDelta?: { tagsAdd?: string[]; tagsRemove?: string[] };
  previous?: Note;
  fields?: readonly NoteMetadataField[];
};

async function queueOfflineUpsert(
  username: string,
  note: Note,
  { tempNoteId, tagDelta, previous, fields }: QueuedUpsert = {},
): Promise<Note> {
  await upsertNoteInCache(username, note, true);
  const localCreate = isLocalTempNoteId(note.id);
  const delta = localCreate ? undefined : tagDelta;
  await enqueueCoalescedNoteUpdate(
    username,
    note.id,
    note,
    baseUpdatedAt(note),
    // A local-* row cached before this call still needs adopting on flush.
    tempNoteId ?? (localCreate ? note.id : undefined),
    delta,
    metadataSelection(previous, note, !!delta, fields),
  );
  if (localCreate) {
    // The outbox row now carries this create; the healer no longer needs a marker.
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await clearCreateInFlight(db, note.id);
  }
  return note;
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
  }
  await adoptServerNoteInCache(username, saved, localId);
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
  opts?: NoteUpsertOpts,
): Promise<Note> {
  // Until the POST settles (adopted, or failed and queued), another tab's
  // healer must not create this note too.
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await markCreateInFlight(db, note.id);
  try {
    const saved = await createNoteItem(
      wgwNoteUpsertFromNote(note, { starred: !!note.starred, archived: !!note.archived }),
      { signal: opts?.signal },
    );
    if (isLocalTempNoteId(saved.id)) {
      return await queueOfflineUpsert(username, { ...saved, id: note.id }, { tempNoteId: note.id });
    }
    await adoptServerCreatedNote(username, note.id, saved);
    opts?.onCreated?.(saved);
    await runner.flush();
    return saved;
  } finally {
    await clearCreateInFlight(db, note.id);
  }
}

async function upsertNoteOnline(
  username: string,
  note: Note,
  runner: ConnectivitySyncRunner<OutboxFlushResult>,
  opts?: NoteUpsertOpts,
  previous?: Note,
): Promise<Note> {
  if (isLocalTempNoteId(note.id)) {
    return createLocalTempNoteOnline(username, note, runner, opts);
  }
  const delta = tagDeltaFromOpts(opts);
  const selection = metadataSelection(previous, note, !!delta, opts?.fields);
  const metadataRequest = wgwNoteMetadataFromNote(note, {
    ...(selection.includeStarred ? { starred: !!note.starred } : {}),
    archived: !!note.archived,
    includeTitle: selection.includeTitle,
    includeTags: selection.includeTags,
    includeNotebook: selection.includeNotebook,
  });
  const request = delta ? { ...metadataRequest, ...delta } : metadataRequest;
  try {
    const saved = await updateNoteItem(note.id, request, { signal: opts?.signal });
    await upsertNoteInCache(username, saved, false);
    await runner.flush();
    return saved;
  } catch (error) {
    const status = persistHttpStatus(error);
    // 412 is retried inside updateNoteItem with a merged payload. A second
    // replay here would send the stale snapshot again. A 412 that still
    // fails belongs in the outbox (shouldQueueNotesUpsert).
    if (status !== 404) throw error;
    if (await isNeverSyncedPendingNote(username, note.id)) {
      return queueOfflineUpsert(username, note, {
        tempNoteId: tempNoteIdForCreate(undefined, note),
        tagDelta: delta,
        previous,
        fields: opts?.fields,
      });
    }
    await dropLocalNoteAfterServerGone(username, note.id);
    throw error;
  }
}

export function createHybridNotesOperations(username: string): NotesAPIOperations {
  const runner = runnerFor(username);

  return {
    upsertNote: async (input, opts) => {
      // A stale local-* row (reload, other tab) of a note the server already
      // has writes to that note, online or queued, instead of creating another.
      const adoptedId = await adoptedServerNoteId(username, input.id);
      const note = adoptedId ? { ...input, id: adoptedId } : input;
      const existing = note.id
        ? await resolveCachedNote(username, note.id, opts?.signal)
        : undefined;
      // A debounced save names its fields: lay only those over the cached copy,
      // which may already hold edits made after this one (a tag, a star).
      const fields = isLocalTempNoteId(note.id) ? undefined : opts?.fields;
      const patch = fields ? { id: note.id, ...noteFieldsPatch(note, fields) } : note;
      // Without a cached copy, keep the full note locally rather than a partial
      // one; metadataSelection still limits what goes on the wire.
      const merged = existing ? applyNoteUpdate(existing, patch) : note;
      const tagDelta = tagDeltaFromOpts(opts);
      const queued = { tagDelta, previous: existing, fields };
      if (!readBrowserOnline()) {
        const tempId = tempNoteIdForCreate(existing, merged);
        const optimistic = tempId ? { ...merged, id: tempId } : merged;
        return queueOfflineUpsert(username, optimistic, { ...queued, tempNoteId: tempId });
      }
      try {
        return await enqueueNoteMetadataWrite(merged.id, () =>
          upsertNoteOnline(username, merged, runner, opts, existing),
        );
      } catch (error) {
        if (!shouldQueueNotesUpsert(error, merged, opts?.signal)) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
        const tempId = tempNoteIdForCreate(existing, merged);
        const optimistic = tempId ? { ...merged, id: tempId } : merged;
        return queueOfflineUpsert(username, optimistic, { ...queued, tempNoteId: tempId });
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
        await renameNotebookInCache(username, from, to);
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
        await renameNotebookInCache(username, from, to);
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        await renameNotebookInCache(username, from, to);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "renameNotebook",
          payload: JSON.stringify({ from, to }),
        });
      }
    },
    deleteNotebook: async (name, action, opts) => {
      const cached = await readNotesBootstrapFromCache(username);
      const moveNotesTo =
        action.kind === "move"
          ? cachedMoveTarget(cached?.data.notebookCollections, action.target)
          : undefined;
      const cacheOptions = {
        keepPendingNotes: false as const,
        ...(moveNotesTo ? { moveNotesTo } : {}),
      };
      if (!readBrowserOnline()) {
        await removeNotebookFromCache(username, name, cacheOptions);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "deleteNotebook",
          payload: JSON.stringify({ name, action }),
        });
        return;
      }
      try {
        await deleteNotebookApi(name, action, opts);
        await removeNotebookFromCache(username, name, cacheOptions);
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        await removeNotebookFromCache(username, name, cacheOptions);
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
  // Before the request: a create adopted after this time may be missing from the list.
  const takenAt = Date.now();
  const bootstrap = await fetchNotesLiveBootstrap();
  const username = bootstrap.session.user.username;
  if (!username) {
    throw new Error("Notes bootstrap missing username");
  }
  if (readBrowserOnline()) {
    await enqueueOrphanPendingLocalCreates(username, bootstrap.data.notes);
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
    await writeNotesBootstrapToCache(username, cached, takenAt);
    return cached;
  }
  bootstrap.data.notes = await enrichNotesListPreviewsFromCollabOffline(
    username,
    bootstrap.data.notes,
  );
  await writeNotesBootstrapToCache(username, bootstrap, takenAt);
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
