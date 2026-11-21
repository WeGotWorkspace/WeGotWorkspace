import { useCallback, useMemo } from "react";
import { defaultJmapPushHub } from "@/lib/api/wgw/jmap-push";
import type { JmapPushHubLike } from "@/lib/api/wgw/use-jmap-state-change";
import { PUSH_PULLED_MAX_CHANGE_PAGES, usePushPulledList } from "@/lib/live/use-push-pulled-list";
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
  type DocsThreadsClient,
} from "./docs-threads-types";

/** Backup poll while the push stream is down (#2286). */
export const DOCS_THREADS_POLL_MS = 4_000;

const DOC_THREAD_PUSH_TYPE = "DocThread";

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

/**
 * Most `files/threads/changes` pages one pull walks; the walk itself is the
 * shared doorbell pull in `@/lib/live/use-push-pulled-list`.
 */
export const DOCS_THREADS_MAX_CHANGE_PAGES = PUSH_PULLED_MAX_CHANGE_PAGES;

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
  // Docs declares only its feed: the `DocThread` push type, the 4 s backup
  // poll, and a mock client's local snapshot. Fetching, paging, resync and
  // the doorbell are the shared pull (#2298).
  const snapshot = useMemo(
    () => (client && isDocsThreadsSnapshotClient(client) ? () => client.snapshot() : null),
    [client],
  );
  const {
    items: fileThreads,
    setItems: setFileThreads,
    loaded,
    reload,
  } = usePushPulledList<DocsFileThread>({
    client,
    scope: path,
    live: poll,
    pushType: DOC_THREAD_PUSH_TYPE,
    pollMs: DOCS_THREADS_POLL_MS,
    snapshot,
    pushHub,
    isCannotCalculate: isDocsThreadsCannotCalculateChanges,
    label: "docs-threads",
  });

  const upsert = useCallback(
    (thread: DocsFileThread) => {
      setFileThreads((prev) => upsertThread(prev, thread));
    },
    [setFileThreads],
  );

  const remove = useCallback(
    (threadId: string) => {
      setFileThreads((prev) => prev.filter((item) => item.id !== threadId));
    },
    [setFileThreads],
  );

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
