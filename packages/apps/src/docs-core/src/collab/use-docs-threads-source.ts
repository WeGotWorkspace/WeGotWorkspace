import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultJmapPushHub } from "@/lib/api/wgw/jmap-push";
import {
  useJmapPushConnected,
  useJmapStateChange,
  type JmapPushHubLike,
} from "@/lib/api/wgw/use-jmap-state-change";
import { splitDocsFileThreads } from "./docs-threads-assemble";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";
import type {
  DocsSuggestionThread,
  DocsSuggestionWithThread,
} from "@/text-editor-core/docs-collab/docs-suggestions-types";
import { isDocsThreadsCannotCalculateChanges } from "./docs-threads-errors";
import {
  isDocsThreadsSnapshotClient,
  type DocsFileThread,
  type DocsFileThreadChanges,
  type DocsThreadsClient,
} from "./docs-threads-types";

/** Backup poll while the push stream is down (#2286). */
export const DOCS_THREADS_POLL_MS = 4_000;

const DOC_THREAD_PUSH_TYPES = ["DocThread"] as const;
const NO_PUSH_TYPES: readonly string[] = [];

export type DocsThreadsSource = {
  fileThreads: DocsFileThread[];
  /**
   * `fileThreads` is the server's list for the current path. False before the
   * first load and right after the path changes (a move), when the list may
   * still be another path's or empty.
   */
  loaded: boolean;
  comments: DocsCommentThread[];
  suggestions: DocsSuggestionThread[];
  archivedSuggestions: DocsSuggestionWithThread[];
  upsert: (thread: DocsFileThread) => void;
  remove: (threadId: string) => void;
  reload: () => Promise<void>;
};

function sortThreads(threads: DocsFileThread[]): DocsFileThread[] {
  return [...threads].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function upsertThread(list: DocsFileThread[], thread: DocsFileThread): DocsFileThread[] {
  const next = list.filter((item) => {
    if (item.id === thread.id) return false;
    if (
      thread.kind === "suggestion" &&
      thread.changeId &&
      item.kind === "suggestion" &&
      item.changeId === thread.changeId
    ) {
      return false;
    }
    return true;
  });
  next.push(thread);
  return sortThreads(next);
}

function hasChanges(changes: DocsFileThreadChanges): boolean {
  return changes.created.length > 0 || changes.updated.length > 0 || changes.destroyed.length > 0;
}

/**
 * Most `files/threads/changes` pages one pull walks. The server pages at 200
 * rows; a pull that hits this cap answers false, so the push hub offers the
 * state again and the next pull goes on from where this one stopped.
 */
export const DOCS_THREADS_MAX_CHANGE_PAGES = 20;

type DocsThreadPull = {
  /** The state to pull on next: the `newState` of the last page read. */
  state: string;
  /** False when the cap stopped the walk with more pages left. */
  complete: boolean;
};

/**
 * One pull round on `since`, following `hasMoreChanges` page by page: a
 * shared document's `since` can fall many pages behind, because writes on
 * the owner's other documents move the pool but do not ring this document.
 * Reloads once when any page names a thread. When the server no longer knows
 * a state (`cannotCalculateChanges`: expired, or from before a reset), it
 * starts over with a fresh state and a full reload, like the other offline
 * caches. The fresh state is taken before the reload, so a change in between
 * shows up again on the next pull. A failed request or reload rejects, so the
 * caller keeps the old state and the next round tries again.
 */
async function pullDocsThreadChanges(
  client: DocsThreadsClient,
  path: string,
  since: string | null,
  reload: () => Promise<void>,
): Promise<DocsThreadPull> {
  let state = since;
  let changed = false;
  for (let page = 0; page < DOCS_THREADS_MAX_CHANGE_PAGES; page += 1) {
    let changes: DocsFileThreadChanges;
    try {
      changes = await client.changes(path, state);
    } catch (error) {
      if (!isDocsThreadsCannotCalculateChanges(error)) throw error;
      try {
        const fresh = await client.changes(path, null);
        await reload();
        return { state: fresh.newState, complete: true };
      } catch (resyncError) {
        // The second failure in a row: report it rather than retry in silence.
        console.warn("[docs-threads] full reload after an expired sync state failed", resyncError);
        throw resyncError;
      }
    }
    if (hasChanges(changes)) changed = true;
    state = changes.newState;
    if (!changes.hasMoreChanges) {
      if (changed) await reload();
      return { state, complete: true };
    }
  }
  if (changed) await reload();
  return { state: state ?? "", complete: false };
}

function immediateSnapshot(client: DocsThreadsClient | null): DocsFileThread[] {
  if (!client || !isDocsThreadsSnapshotClient(client)) return [];
  return client.snapshot();
}

export function useDocsThreadsSource({
  client,
  path,
  poll = false,
  pushHub = defaultJmapPushHub(),
}: {
  client: DocsThreadsClient | null;
  path: string | null;
  /** Follow other people's thread changes: on a `DocThread` push, or by polling while push is down. */
  poll?: boolean;
  /** The browser's push hub; null (mock data) leaves only the poll. */
  pushHub?: JmapPushHubLike | null;
}): DocsThreadsSource {
  const [fileThreads, setFileThreads] = useState<DocsFileThread[]>(() => immediateSnapshot(client));
  const [loadedFor, setLoadedFor] = useState<{
    client: DocsThreadsClient | null;
    path: string | null;
  } | null>(() => (client && isDocsThreadsSnapshotClient(client) ? { client, path } : null));
  const sinceRef = useRef<string | null>(null);
  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    if (!client || !path) {
      setFileThreads([]);
      setLoadedFor(null);
      return;
    }
    if (isDocsThreadsSnapshotClient(client)) {
      setFileThreads(client.snapshot());
      setLoadedFor({ client, path });
      return;
    }
    const request = ++latestRequest.current;
    const list = await client.list(path);
    // A slower list for the path before a move must not overwrite this one.
    if (request !== latestRequest.current) return;
    setFileThreads(list);
    setLoadedFor({ client, path });
  }, [client, path]);

  const loaded = Boolean(client && path) && loadedFor?.client === client && loadedFor.path === path;
  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    // A failed list leaves `loaded` false; the next pull retries it.
    reload().catch(() => undefined);
  }, [reload]);

  const live = Boolean(poll && client && path && !isDocsThreadsSnapshotClient(client));
  /** One pull round for the current client and path; resolves false when it failed. */
  const pullRef = useRef<() => Promise<boolean>>(async () => true);

  useEffect(() => {
    if (!live || !client || !path) {
      pullRef.current = async () => true;
      return;
    }
    let cancelled = false;
    pullRef.current = async () => {
      try {
        // Until a list for this path has arrived, retry it: an empty changes
        // feed (a document without threads) would never trigger a reload.
        if (!loadedRef.current) {
          await reload();
          return true;
        }
        const pulled = await pullDocsThreadChanges(client, path, sinceRef.current, () =>
          cancelled ? Promise.resolve() : reload(),
        );
        sinceRef.current = pulled.state;
        return pulled.complete;
      } catch {
        // Retried on the next push or poll.
        return false;
      }
    };
    return () => {
      cancelled = true;
    };
  }, [client, live, path, reload]);

  // Push is the doorbell (#2286): a `DocThread` state change means a thread the
  // user can read changed somewhere, so this document pulls its changes once.
  // A failed pull resolves false, so the hub offers the state again.
  const pushConnected = useJmapPushConnected(pushHub);
  useJmapStateChange(
    live ? DOC_THREAD_PUSH_TYPES : NO_PUSH_TYPES,
    () => pullRef.current(),
    pushHub,
  );

  // The interval poll is only the backup while push is down.
  useEffect(() => {
    if (!live || pushConnected) return;
    const id = window.setInterval(() => void pullRef.current(), DOCS_THREADS_POLL_MS);
    return () => window.clearInterval(id);
  }, [client, live, path, pushConnected]);

  const upsert = useCallback((thread: DocsFileThread) => {
    setFileThreads((prev) => upsertThread(prev, thread));
  }, []);

  const remove = useCallback((threadId: string) => {
    setFileThreads((prev) => prev.filter((item) => item.id !== threadId));
  }, []);

  const split = useMemo(() => splitDocsFileThreads(fileThreads), [fileThreads]);

  return useMemo(
    () => ({
      fileThreads,
      loaded,
      comments: split.comments,
      suggestions: split.suggestions,
      archivedSuggestions: split.archivedSuggestions,
      upsert,
      remove,
      reload,
    }),
    [
      fileThreads,
      loaded,
      reload,
      remove,
      split.archivedSuggestions,
      split.comments,
      split.suggestions,
      upsert,
    ],
  );
}
