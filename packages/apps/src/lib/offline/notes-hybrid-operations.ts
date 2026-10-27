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
  createNotebook as createNotebookApi,
  patchNotebookCollection as patchNotebookApi,
  deleteNotebook as deleteNotebookApi,
  deleteNoteItem,
  fetchNotesLiveBootstrap,
  renameNotebook as renameNotebookApi,
  restoreNoteItem,
  updateNoteItem,
  wgwNoteMetadataFromNote,
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
  getNoteFromCache,
  listOutboxMutations,
  readNotesBootstrapFromCache,
  removeNoteFromCache,
  removeNotebookFromCache,
  removeOutboxMutationsForNote,
  renameNotebookInCache,
  upsertNoteBodyPreviewInCache,
  upsertNoteInCache,
  upsertNotebookInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { isNotesPersistGone, persistHttpStatus } from "@/notes-core/src/notes-persist-access";
import { NOTES_DOMAIN, notesNotesTable } from "@/lib/offline/notes/notes-schema";
import {
  baseUpdatedAt,
  metadataSelection,
  noteFieldsPatch,
} from "@/lib/offline/notes/notes-metadata-selection";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { notifyOtherTabsOnStructuralChanges } from "@/lib/offline/notes/notes-cross-tab-notify";
import { flushNotesOutbox, type OutboxFlushResult } from "@/lib/offline/notes-outbox-flush";
import { reportNotesSyncConflicts } from "@/lib/offline/notes-sync-conflicts";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
import {
  isNoteArchivedRefusal,
  settleNoteArchivedElsewhere,
} from "@/lib/offline/notes/notes-archived-elsewhere";

function rethrowUnlessOfflineQueue(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw error;
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (!isFetchNetworkError(error)) throw error;
}

/** Queue instead of failing the write. Auth stays thrown. */
function shouldQueueNotesUpsert(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const status = persistHttpStatus(error);
  if (status === 401 || status === 403) return false;
  if (status === 412) return true;
  return status != null && status >= 500;
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

function withCreatePending(note: Note, createPending: boolean): Note {
  if (createPending) return { ...note, createPending: true };
  const { createPending: _done, ...rest } = note;
  return rest;
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

type NoteUpsertOpts = Parameters<NotesAPIOperations["upsertNote"]>[1];

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<OutboxFlushResult>(NOTES_DOMAIN);

async function flushNotesOutboxAndReport(username: string): Promise<OutboxFlushResult> {
  const result = await flushNotesOutbox(username);
  reportNotesSyncConflicts(result.stateMismatches);
  return result;
}

function runnerFor(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return syncRunnerRegistry.getOrCreate(username, () => flushNotesOutboxAndReport(username));
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
  tagDelta?: { tagsAdd?: string[]; tagsRemove?: string[] };
  previous?: Note;
  fields?: readonly NoteMetadataField[];
};

/**
 * Cache the note and queue its write in one transaction, so a pending row
 * never exists without its outbox row. A note not on the server yet queues
 * its create (with its own UID); later edits coalesce into that same row.
 */
async function queueOfflineUpsert(
  username: string,
  note: Note,
  { tagDelta, previous, fields }: QueuedUpsert = {},
): Promise<Note> {
  const create = note.createPending === true;
  const delta = create ? undefined : tagDelta;
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.transaction("rw", [notesNotesTable(db), db.outbox], async () => {
    await upsertNoteInCache(username, note, true);
    await enqueueCoalescedNoteUpdate(
      username,
      note.id,
      note,
      baseUpdatedAt(note),
      create,
      delta,
      metadataSelection(previous, note, !!delta, fields),
    );
  });
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

async function upsertNoteOnline(
  username: string,
  note: Note,
  runner: ConnectivitySyncRunner<OutboxFlushResult>,
  opts?: NoteUpsertOpts,
  previous?: Note,
): Promise<Note> {
  const delta = tagDeltaFromOpts(opts);
  const selection = metadataSelection(previous, note, !!delta, opts?.fields);
  const sendsMetadata =
    !!delta ||
    selection.includeTitle ||
    selection.includeTags ||
    selection.includeStarred ||
    selection.includeNotebook;
  // The body travels through the collab save. A PATCH with nothing in it
  // only bumps the version, so the next real save would conflict.
  if (!sendsMetadata) {
    await upsertNoteBodyPreviewInCache(username, note);
    return note;
  }
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
    if (isNoteArchivedRefusal(error)) {
      // Archived elsewhere (#1535): archive wins, and the person is told.
      const archived = await settleNoteArchivedElsewhere(username, note.id);
      if (archived) return archived;
    }
    if (status !== 404) throw error;
    await dropLocalNoteAfterServerGone(username, note.id);
    throw error;
  }
}

export function createHybridNotesOperations(username: string): NotesAPIOperations {
  const runner = runnerFor(username);

  return notifyOtherTabsOnStructuralChanges(username, {
    upsertNote: async (note, opts) => {
      // A note made here is not on the server yet: only the cache can know it.
      const existing = note.createPending
        ? ((await getNoteFromCache(username, note.id)) ?? undefined)
        : note.id
          ? await resolveCachedNote(username, note.id, opts?.signal)
          : undefined;
      // The cache knows best: the UI may still show the flag after the create landed.
      const createPending = existing
        ? existing.createPending === true
        : note.createPending === true;
      // A debounced save names its fields: lay only those over the cached copy,
      // which may already hold edits made after this one (a tag, a star).
      const fields = createPending ? undefined : opts?.fields;
      const patch = fields ? { id: note.id, ...noteFieldsPatch(note, fields) } : note;
      // Without a cached copy, keep the full note locally rather than a partial
      // one; metadataSelection still limits what goes on the wire.
      const merged = withCreatePending(
        existing ? applyNoteUpdate(existing, patch) : note,
        createPending,
      );
      const queued = { tagDelta: tagDeltaFromOpts(opts), previous: existing, fields };
      // Not on the server yet, or offline: the outbox keeps the order (create
      // first), and online it is sent right away.
      if (createPending || !readBrowserOnline()) {
        const saved = await queueOfflineUpsert(username, merged, queued);
        if (readBrowserOnline()) void runner.flush();
        return saved;
      }
      try {
        return await enqueueNoteMetadataWrite(merged.id, () =>
          upsertNoteOnline(username, merged, runner, opts, existing),
        );
      } catch (error) {
        if (!shouldQueueNotesUpsert(error, opts?.signal)) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
        return queueOfflineUpsert(username, merged, queued);
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
      if (!readBrowserOnline() || existing.createPending) {
        const optimistic = { ...existing, archived: true };
        await upsertNoteInCache(username, optimistic, true);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "archive",
          // The version it started from: inbound sync tells "not sent yet" from a conflict.
          ...(existing.etag ? { ifInState: existing.etag } : {}),
          payload: JSON.stringify({ noteId: id, ...(groupSlug ? { groupSlug } : {}) }),
        });
        if (readBrowserOnline()) void runner.flush();
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
          // The version it started from: inbound sync tells "not sent yet" from a conflict.
          ...(existing.etag ? { ifInState: existing.etag } : {}),
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
      if (!readBrowserOnline() || existing.createPending) {
        const optimistic = { ...existing, archived: false };
        await upsertNoteInCache(username, optimistic, true);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "restore",
          // The version it started from: inbound sync tells "not sent yet" from a conflict.
          ...(existing.etag ? { ifInState: existing.etag } : {}),
          payload: JSON.stringify({ noteId: id, ...(groupSlug ? { groupSlug } : {}) }),
        });
        if (readBrowserOnline()) void runner.flush();
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
          // The version it started from: inbound sync tells "not sent yet" from a conflict.
          ...(existing.etag ? { ifInState: existing.etag } : {}),
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
  });
}

export async function fetchNotesHybridBootstrap(): Promise<
  Awaited<ReturnType<typeof fetchNotesLiveBootstrap>>
> {
  // Before the request: a note created after this time may be missing from the list.
  const takenAt = Date.now();
  const bootstrap = await fetchNotesLiveBootstrap();
  const username = bootstrap.session.user.username;
  if (!username) {
    throw new Error("Notes bootstrap missing username");
  }
  const hadOutbox = readBrowserOnline() && (await listOutboxMutations(username)).length > 0;
  if (hadOutbox) await runnerFor(username).flush();
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
