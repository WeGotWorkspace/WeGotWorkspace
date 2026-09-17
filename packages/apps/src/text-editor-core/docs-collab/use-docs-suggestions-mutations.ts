import { useCallback, useRef } from "react";
import { createCommentMessage } from "./docs-suggestions/docs-suggestions-map-writes";
import type { DocsCommentAuthor } from "./docs-comments-types";
import type { DocsFileThread, DocsFileThreadCreate, DocsThreadsClient } from "./docs-threads-types";
import type { DocsThreadsSource } from "./use-docs-threads-source";
import { createDocsCommentId } from "./docs-comments-map";

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

function archiveCreateInput(
  changeId: string,
  snapshot: DocsSuggestionArchiveSnapshot | undefined,
): DocsFileThreadCreate {
  const input: DocsFileThreadCreate = {
    id: createDocsCommentId(),
    kind: "suggestion",
    changeId,
    body: "",
    anchorText: snapshot?.summary || snapshot?.anchorText || "",
  };
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

  const addReply = useCallback(
    (changeId: string, body: string) => {
      if (!client || !path) return Promise.resolve();

      const message = createCommentMessage(body, currentUser);
      if (!message) return Promise.resolve();

      return (async () => {
        const existing = suggestionRoot(source.fileThreads, changeId);
        if (existing) {
          source.upsert(
            await client.reply(path, existing.id, { id: message.id, body: message.body }),
          );
          return;
        }
        source.upsert(
          await client.create(path, {
            id: createDocsCommentId(),
            kind: "suggestion",
            changeId,
            body: message.body,
          }),
        );
      })();
    },
    [client, currentUser, path, source],
  );

  const toggleReaction = useCallback(
    (changeId: string, emoji: string) => {
      if (!client || !path) return Promise.resolve();
      return (async () => {
        let existing = suggestionRoot(source.fileThreads, changeId);
        if (!existing) {
          existing = await client.create(path, {
            id: createDocsCommentId(),
            kind: "suggestion",
            changeId,
            body: "",
          });
        }
        source.upsert(await client.react(path, existing.id, emoji));
      })();
    },
    [client, path, source],
  );

  const archiveSuggestion = useCallback(
    (changeId: string, snapshot?: DocsSuggestionArchiveSnapshot) => {
      if (!client || !path) return Promise.resolve();
      const existing = suggestionJournal(source.fileThreads, changeId);
      if (existing?.archived) return Promise.resolve();
      if (inflight.current.has(changeId)) return Promise.resolve();
      inflight.current.add(changeId);

      return (async () => {
        const journal =
          existing ?? (await client.create(path, archiveCreateInput(changeId, snapshot)));
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
    [client, path, source],
  );

  return { addReply, toggleReaction, archiveSuggestion };
}
