import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitDocsFileThreads } from "./docs-threads-assemble";
import type { DocsCommentThread } from "./docs-comments-types";
import type { DocsSuggestionThread } from "./docs-suggestions-types";
import {
  isDocsThreadsSnapshotClient,
  type DocsFileThread,
  type DocsThreadsClient,
} from "./docs-threads-types";

export const DOCS_THREADS_POLL_MS = 4_000;

export type DocsThreadsSource = {
  fileThreads: DocsFileThread[];
  comments: DocsCommentThread[];
  suggestions: DocsSuggestionThread[];
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
  const next = list.filter((item) => item.id !== thread.id);
  if (thread.kind === "suggestion" && thread.archived) return sortThreads(next);
  next.push(thread);
  return sortThreads(next);
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
  const sinceRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!client || !path) {
      setFileThreads([]);
      return;
    }
    if (isDocsThreadsSnapshotClient(client)) {
      setFileThreads(client.snapshot());
      return;
    }
    const list = await client.list(path);
    setFileThreads(list);
  }, [client, path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!poll || !client || !path || isDocsThreadsSnapshotClient(client)) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const changes = await client.changes(path, sinceRef.current);
        sinceRef.current = changes.newState;
        if (
          cancelled ||
          (changes.created.length === 0 &&
            changes.updated.length === 0 &&
            changes.destroyed.length === 0)
        ) {
          return;
        }
        await reload();
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
      comments: split.comments,
      suggestions: split.suggestions,
      upsert,
      remove,
      reload,
    }),
    [fileThreads, reload, remove, split.comments, split.suggestions, upsert],
  );
}
