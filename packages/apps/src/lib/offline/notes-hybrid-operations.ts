import type { Note } from "@/lib/models/note";
import type { DeleteNotebookAction, NotesAPIOperations } from "@/notes-core/src/notes-types";
import {
  backfillNotesContentFromServer,
  preserveLocalListableBodiesOnServerNotes,
} from "@/notes-core/src/notes-note-utils";
import {
  archiveNoteItem,
  createNoteItem,
  createNotebook as createNotebookApi,
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
  isLocalTempNoteId,
  enqueueCoalescedNoteUpdate,
  enqueueOutboxMutation,
  listOutboxMutations,
  readNotesBootstrapFromCache,
  removeNoteFromCache,
  removeOutboxMutationsForNote,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
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

function notebookDeleteBodyForAction(action: DeleteNotebookAction): {
  mode: "archive" | "move" | "purge";
  target?: string;
} {
  if (action.kind === "archive") return { mode: "archive" };
  if (action.kind === "purge") return { mode: "purge" };
  return { mode: "move", target: action.target };
}

function baseUpdatedAt(note: Note): string | undefined {
  // Prefer the metadata concurrency token; fall back to date for legacy cached rows.
  if (note.updatedAt) return note.updatedAt;
  return note.date !== "—" ? note.date : undefined;
}

function applyNoteUpdate(existing: Note, patch: Note): Note {
  return { ...existing, ...patch };
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

async function queueOfflineDelete(
  username: string,
  note: Pick<Note, "id" | "notebook" | "archived">,
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
    }),
  });
}

async function resolveDeleteTarget(
  username: string,
  note: Pick<Note, "id" | "notebook" | "archived">,
): Promise<Pick<Note, "id" | "notebook" | "archived">> {
  const cached = note.id ? await resolveCachedNote(username, note.id) : undefined;
  if (cached) {
    return {
      id: note.id,
      notebook: cached.notebook,
      archived: cached.archived ?? note.archived ?? false,
    };
  }
  return {
    id: note.id,
    notebook: note.notebook,
    archived: !!note.archived,
  };
}

async function upsertNoteOnline(
  username: string,
  note: Note,
  runner: ConnectivitySyncRunner<OutboxFlushResult>,
  opts?: { signal?: AbortSignal },
): Promise<Note> {
  // Metadata-only PUT preserves the on-disk body; the 404 create fallback sends
  // the full note so a brand-new note's (empty) body is initialised once.
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
    const status = (error as { status?: number } | undefined)?.status;
    if (status !== 404) throw error;
    const saved = await createNoteItem(
      wgwNoteUpsertFromNote(note, { starred: !!note.starred, archived: !!note.archived }),
      opts,
    );
    await upsertNoteInCache(username, saved, false);
    await runner.flush();
    return saved;
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
        return await upsertNoteOnline(username, merged, runner, opts);
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
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
        await deleteNoteItem(
          target.id,
          { notebook: target.notebook, archived: !!target.archived },
          opts,
        );
        await removeNoteFromCache(username, target.id);
        await runner.flush();
      } catch (error) {
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
      if (!readBrowserOnline()) {
        const optimistic = { ...existing, archived: true };
        await upsertNoteInCache(username, optimistic, true);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "archive",
          payload: JSON.stringify({ noteId: id }),
        });
        return optimistic;
      }
      try {
        const saved = await archiveNoteItem(id, opts);
        await upsertNoteInCache(username, saved, false);
        await runner.flush();
        return saved;
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        const optimistic = { ...existing, archived: true };
        await upsertNoteInCache(username, optimistic, true);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "archive",
          payload: JSON.stringify({ noteId: id }),
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
      if (!readBrowserOnline()) {
        const optimistic = { ...existing, archived: false };
        await upsertNoteInCache(username, optimistic, true);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "restore",
          payload: JSON.stringify({ noteId: id }),
        });
        return optimistic;
      }
      try {
        const saved = await restoreNoteItem(id, opts);
        await upsertNoteInCache(username, saved, false);
        await runner.flush();
        return saved;
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        const optimistic = { ...existing, archived: false };
        await upsertNoteInCache(username, optimistic, true);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "restore",
          payload: JSON.stringify({ noteId: id }),
        });
        return optimistic;
      }
    },
    createNotebook: async (name, opts) => {
      if (!readBrowserOnline()) {
        const cached = await readNotesBootstrapFromCache(username);
        if (cached && !cached.data.notebooks.includes(name)) {
          cached.data.notebooks.push(name);
          await writeNotesBootstrapToCache(username, cached);
        }
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "createNotebook",
          payload: JSON.stringify({ name }),
        });
        return;
      }
      try {
        await createNotebookApi(name, opts);
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        const cached = await readNotesBootstrapFromCache(username);
        if (cached && !cached.data.notebooks.includes(name)) {
          cached.data.notebooks.push(name);
          await writeNotesBootstrapToCache(username, cached);
        }
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: NOTES_DOMAIN,
          op: "createNotebook",
          payload: JSON.stringify({ name }),
        });
      }
    },
    renameNotebook: async (from, to, opts) => {
      if (!readBrowserOnline()) {
        const cached = await readNotesBootstrapFromCache(username);
        if (cached) {
          cached.data.notebooks = cached.data.notebooks.map((n) => (n === from ? to : n));
          cached.data.notes = cached.data.notes.map((n) =>
            n.notebook === from ? { ...n, notebook: to } : n,
          );
          await writeNotesBootstrapToCache(username, cached);
        }
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
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        const cached = await readNotesBootstrapFromCache(username);
        if (cached) {
          cached.data.notebooks = cached.data.notebooks.map((n) => (n === from ? to : n));
          cached.data.notes = cached.data.notes.map((n) =>
            n.notebook === from ? { ...n, notebook: to } : n,
          );
          await writeNotesBootstrapToCache(username, cached);
        }
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
        const cached = await readNotesBootstrapFromCache(username);
        if (cached) {
          cached.data.notebooks = cached.data.notebooks.filter((n) => n !== name);
          await writeNotesBootstrapToCache(username, cached);
        }
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
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        const cached = await readNotesBootstrapFromCache(username);
        if (cached) {
          cached.data.notebooks = cached.data.notebooks.filter((n) => n !== name);
          await writeNotesBootstrapToCache(username, cached);
        }
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
  const hadOutbox = readBrowserOnline() && (await listOutboxMutations(username)).length > 0;
  if (readBrowserOnline()) {
    await flushNotesOutboxAndReport(username);
  }
  const cached = await readNotesBootstrapFromCache(username);
  if (cached) {
    cached.session = bootstrap.session;
    if (bootstrap.data.notebooks.length > 0) {
      cached.data.notebooks = bootstrap.data.notebooks;
    }
    cached.data.sharedNotebooks = bootstrap.data.sharedNotebooks ?? [];
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
    await writeNotesBootstrapToCache(username, cached);
    return cached;
  }
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
      if (cached) return cached;
    }
    throw new Error("No cached notes available offline");
  }

  return fetchNotesHybridBootstrap();
}

export function getNotesSyncRunner(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return runnerFor(username);
}
