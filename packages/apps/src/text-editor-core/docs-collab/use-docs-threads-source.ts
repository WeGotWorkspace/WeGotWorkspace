import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitDocsFileThreads } from "./docs-threads-assemble";
import type { DocsCommentThread } from "./docs-comments-types";
import type { DocsSuggestionThread, DocsSuggestionWithThread } from "./docs-suggestions-types";
import { isDocsThreadsCannotCalculateChanges } from "./docs-threads-errors";
import {
  isDocsThreadsSnapshotClient,
  type DocsFileThread,
  type DocsFileThreadChanges,
  type DocsThreadsClient,
} from "./docs-threads-types";

export const DOCS_THREADS_POLL_MS = 4_000;

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
 * One poll round on `since`; resolves with the state to poll on next. When the
 * server no longer knows `since` (`cannotCalculateChanges`: expired, or from
 * before a reset), it starts over with a fresh state and a full reload, like
 * the other offline caches. The fresh state is taken before the reload, so a
 * change in between shows up again on the next poll. A failed reload rejects,
 * so the caller keeps the old state and the next round tries again.
 */
async function pollDocsThreadChanges(
  client: DocsThreadsClient,
  path: string,
  since: string | null,
  reload: () => Promise<void>,
): Promise<string> {
  let changes: DocsFileThreadChanges;
  try {
    changes = await client.changes(path, since);
  } catch (error) {
    if (!isDocsThreadsCannotCalculateChanges(error)) throw error;
    try {
      const fresh = await client.changes(path, null);
      await reload();
      return fresh.newState;
    } catch (resyncError) {
      // The second failure in a row: report it rather than retry in silence.
      console.warn("[docs-threads] full reload after an expired sync state failed", resyncError);
      throw resyncError;
    }
  }
  if (hasChanges(changes)) await reload();
  return changes.newState;
}

function immediateSnapshot(client: DocsThreadsClient | null): DocsFileThread[] {
  if (!client || !isDocsThreadsSnapshotClient(client)) return [];
  return client.snapshot();
}

export function useDocsThreadsSource({
  client,
  path,
  poll = false,
}: {
  client: DocsThreadsClient | null;
  path: string | null;
  poll?: boolean;
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
    // A failed list leaves `loaded` false; the poll retries it.
    reload().catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    if (!poll || !client || !path || isDocsThreadsSnapshotClient(client)) return;
    let cancelled = false;
    const tick = async () => {
      try {
        // Until a list for this path has arrived, retry it: an empty changes
        // feed (a document without threads) would never trigger a reload.
        if (!loadedRef.current) {
          await reload();
          return;
        }
        sinceRef.current = await pollDocsThreadChanges(client, path, sinceRef.current, () =>
          cancelled ? Promise.resolve() : reload(),
        );
      } catch {
        // Poll errors are retried on the next interval.
      }
    };
    const id = window.setInterval(() => void tick(), DOCS_THREADS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [client, path, poll, reload]);

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
