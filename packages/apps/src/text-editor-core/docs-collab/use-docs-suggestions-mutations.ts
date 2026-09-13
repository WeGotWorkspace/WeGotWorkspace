import { useCallback } from "react";
import { createCommentMessage } from "./docs-suggestions/docs-suggestions-map-writes";
import type { DocsCommentAuthor } from "./docs-comments-types";
import type { DocsFileThread } from "./docs-threads-types";
import type { DocsThreadsClient } from "./docs-threads-types";
import type { DocsThreadsSource } from "./use-docs-threads-source";
import { createDocsCommentId } from "./docs-comments-map";

type UseDocsSuggestionsMutationsOptions = {
  client: DocsThreadsClient | null;
  path: string | null;
  source: DocsThreadsSource;
  currentUser: DocsCommentAuthor;
};

function suggestionRoot(
  fileThreads: DocsFileThread[],
  changeId: string,
): DocsFileThread | undefined {
  return fileThreads.find(
    (thread) => thread.kind === "suggestion" && thread.changeId === changeId && !thread.archived,
  );
}

export function useDocsSuggestionsMutations({
  client,
  path,
  source,
  currentUser,
}: UseDocsSuggestionsMutationsOptions) {
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
    (changeId: string) => {
      if (!client || !path) return Promise.resolve();
      const existing = suggestionRoot(source.fileThreads, changeId);
      return client
        .patch(path, existing?.id ?? changeId, { archived: true, changeId })
        .then((thread) => source.upsert(thread))
        .catch(() => {
          // No discussion sidecar — mark accept/reject still applies.
        });
    },
    [client, path, source],
  );

  return { addReply, toggleReaction, archiveSuggestion };
}
