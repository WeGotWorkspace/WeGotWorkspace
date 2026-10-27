import { useCallback, useRef } from "react";
import { createCommentMessage } from "./docs-suggestions/docs-suggestions-map-writes";
import type { DocsCommentAuthor } from "./docs-comments-types";
import type { DocsFileThread, DocsFileThreadCreate, DocsThreadsClient } from "./docs-threads-types";
import type { DocsThreadsSource } from "./use-docs-threads-source";
import { suggestionThreadIdForChange } from "./docs-suggestions/docs-suggestion-thread-id";

type UseDocsSuggestionsMutationsOptions = {
  client: DocsThreadsClient | null;
  path: string | null;
  source: DocsThreadsSource;
  currentUser: DocsCommentAuthor;
};

export type DocsSuggestionArchiveSnapshot = {
  summary: string;
  anchorText: string;
  from: number;
  to: number;
};

function suggestionJournal(
  fileThreads: DocsFileThread[],
  changeId: string,
): DocsFileThread | undefined {
  return fileThreads.find((thread) => thread.kind === "suggestion" && thread.changeId === changeId);
}

function suggestionRoot(
  fileThreads: DocsFileThread[],
  changeId: string,
): DocsFileThread | undefined {
  const match = suggestionJournal(fileThreads, changeId);
  return match && !match.archived ? match : undefined;
}

function rootCreateInput(
  path: string,
  changeId: string,
  snapshot: DocsSuggestionArchiveSnapshot | undefined,
): DocsFileThreadCreate {
  const input: DocsFileThreadCreate = {
    id: suggestionThreadIdForChange(path, changeId),
    kind: "suggestion",
    changeId,
    body: "",
  };
  const anchorText = snapshot?.summary || snapshot?.anchorText;
  if (anchorText) input.anchorText = anchorText;
  if (typeof snapshot?.from === "number") input.anchorFrom = snapshot.from;
  if (typeof snapshot?.to === "number") input.anchorTo = snapshot.to;
  return input;
}

function applySnapshotAnchors(
  thread: DocsFileThread,
  snapshot: DocsSuggestionArchiveSnapshot | undefined,
): DocsFileThread {
  if (!snapshot) return thread;
  return {
    ...thread,
    anchorText: thread.anchorText || snapshot.summary || snapshot.anchorText,
    anchorFrom: thread.anchorFrom ?? snapshot.from,
    anchorTo: thread.anchorTo ?? snapshot.to,
  };
}

export function useDocsSuggestionsMutations({
  client,
  path,
  source,
  currentUser,
}: UseDocsSuggestionsMutationsOptions) {
  const inflight = useRef(new Set<string>());
  const rootsInflight = useRef(new Map<string, Promise<DocsFileThread>>());

  /**
   * The suggestion thread root for `changeId`, created when missing. One call
   * per change id at a time, and the root id is derived from the change id, so
   * a retry, a second tab or a race returns the same thread.
   */
  const ensureSuggestionRoot = useCallback(
    (changeId: string, snapshot?: DocsSuggestionArchiveSnapshot): Promise<DocsFileThread> => {
      if (!client || !path) return Promise.reject(new Error("no threads client"));
      const existing = suggestionJournal(source.fileThreads, changeId);
      if (existing) return Promise.resolve(existing);
      const pending = rootsInflight.current.get(changeId);
      if (pending) return pending;
      const created = client
        .create(path, rootCreateInput(path, changeId, snapshot))
        .then((thread) => {
          source.upsert(thread);
          return thread;
        })
        .finally(() => {
          rootsInflight.current.delete(changeId);
        });
      rootsInflight.current.set(changeId, created);
      return created;
    },
    [client, path, source],
  );

  /**
   * An open root for a live suggestion. If its journal was archived (accept or
   * reject, then undo brought the mark back) it is reopened, so replies and
   * reactions show on the live card.
   */
  const ensureOpenSuggestionRoot = useCallback(
    async (changeId: string): Promise<DocsFileThread> => {
      const open = suggestionRoot(source.fileThreads, changeId);
      if (open) return open;
      const journal = await ensureSuggestionRoot(changeId);
      if (!journal.archived || !client || !path) return journal;
      const reopened = await client.patch(path, journal.id, { archived: false, changeId });
      source.upsert(reopened);
      return reopened;
    },
    [client, ensureSuggestionRoot, path, source],
  );

  const addReply = useCallback(
    (changeId: string, body: string) => {
      if (!client || !path) return Promise.resolve();

      const message = createCommentMessage(body, currentUser);
      if (!message) return Promise.resolve();

      return (async () => {
        const root = await ensureOpenSuggestionRoot(changeId);
        source.upsert(await client.reply(path, root.id, { id: message.id, body: message.body }));
      })();
    },
    [client, currentUser, ensureOpenSuggestionRoot, path, source],
  );

  const toggleReaction = useCallback(
    (changeId: string, emoji: string) => {
      if (!client || !path) return Promise.resolve();
      return (async () => {
        const root = await ensureOpenSuggestionRoot(changeId);
        source.upsert(await client.react(path, root.id, emoji));
      })();
    },
    [client, ensureOpenSuggestionRoot, path, source],
  );

  const archiveSuggestion = useCallback(
    (changeId: string, snapshot?: DocsSuggestionArchiveSnapshot) => {
      if (!client || !path) return Promise.resolve();
      const existing = suggestionJournal(source.fileThreads, changeId);
      if (existing?.archived) return Promise.resolve();
      if (inflight.current.has(changeId)) return Promise.resolve();
      inflight.current.add(changeId);

      return (async () => {
        const journal = existing ?? (await ensureSuggestionRoot(changeId, snapshot));
        const thread = await client.patch(path, journal.id, {
          archived: true,
          changeId,
          ...(snapshot
            ? {
                anchorText: snapshot.summary || snapshot.anchorText || journal.anchorText,
                anchorFrom: snapshot.from,
                anchorTo: snapshot.to,
              }
            : {}),
        });
        source.upsert(applySnapshotAnchors(thread, snapshot));
      })()
        .catch(() => {
          // Accept/reject still applied the mark; journal persist is best-effort.
        })
        .finally(() => {
          inflight.current.delete(changeId);
        });
    },
    [client, ensureSuggestionRoot, path, source],
  );

  return { addReply, toggleReaction, archiveSuggestion, ensureSuggestionRoot };
}
