import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import { createCommentMessage } from "./docs-comments/docs-comments-map-writes";
import type { DocsCommentAuthor, DocsCommentThread } from "./docs-comments-types";
import type { DocsThreadsSource } from "./use-docs-threads-source";
import type { DocsThreadsClient } from "./docs-threads-types";

type UseDocsCommentsMutationsOptions = {
  client: DocsThreadsClient | null;
  path: string | null;
  source: DocsThreadsSource;
  editor: Editor | null;
  currentUser: DocsCommentAuthor;
  activeThreadId: string | null;
  draftThreadRef: MutableRefObject<DocsCommentThread | null>;
  setDraftThread: Dispatch<SetStateAction<DocsCommentThread | null>>;
  setActiveThreadId: Dispatch<SetStateAction<string | null>>;
  cancelDraft: () => void;
  canMutateComments?: boolean;
};

export function useDocsCommentsMutations({
  client,
  path,
  source,
  editor,
  currentUser,
  activeThreadId,
  draftThreadRef,
  setDraftThread,
  setActiveThreadId,
  cancelDraft,
  canMutateComments = true,
}: UseDocsCommentsMutationsOptions) {
  const addReply = useCallback(
    (threadId: string, body: string) => {
      if (!canMutateComments || !client || !path) return Promise.resolve();

      const trimmed = body.trim();
      if (!trimmed) return Promise.resolve();

      const draft = draftThreadRef.current;
      return (async () => {
        if (draft?.id === threadId) {
          const created = await client.create(path, {
            id: draft.id,
            kind: "comment",
            body: trimmed,
            anchorText: draft.anchorText,
            anchorFrom: draft.anchorFrom,
            anchorTo: draft.anchorTo,
            anchorOccurrence: draft.anchorOccurrence,
          });
          draftThreadRef.current = null;
          setDraftThread(null);
          source.upsert(created);
          return;
        }

        const message = createCommentMessage(trimmed, currentUser);
        if (!message) return;
        const updated = await client.reply(path, threadId, { id: message.id, body: trimmed });
        source.upsert(updated);
      })();
    },
    [canMutateComments, client, currentUser, draftThreadRef, path, setDraftThread, source],
  );

  const toggleReaction = useCallback(
    (threadId: string, emoji: string) => {
      if (!canMutateComments || !client || !path) return Promise.resolve();
      return client.react(path, threadId, emoji).then((thread) => {
        source.upsert(thread);
      });
    },
    [canMutateComments, client, path, source],
  );

  const resolveThread = useCallback(
    (threadId: string) => {
      if (!canMutateComments || !client || !path) return Promise.resolve();
      return client.patch(path, threadId, { resolved: true }).then((thread) => {
        source.upsert(thread);
        editor?.commands.unsetComment(threadId);
        if (activeThreadId === threadId) setActiveThreadId(null);
      });
    },
    [activeThreadId, canMutateComments, client, editor, path, setActiveThreadId, source],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      if (!canMutateComments) return;
      if (draftThreadRef.current?.id === threadId) {
        cancelDraft();
        return;
      }
      source.remove(threadId);
      if (client && "forget" in client && typeof client.forget === "function") {
        client.forget(threadId);
      }
      editor?.commands.unsetComment(threadId);
      if (activeThreadId === threadId) setActiveThreadId(null);
    },
    [
      activeThreadId,
      canMutateComments,
      cancelDraft,
      client,
      draftThreadRef,
      editor,
      setActiveThreadId,
      source,
    ],
  );

  const submitDraftComment = useCallback(
    (body: string) => {
      const draft = draftThreadRef.current;
      if (!draft) return Promise.resolve();
      return addReply(draft.id, body) ?? Promise.resolve();
    },
    [addReply, draftThreadRef],
  );

  return {
    addReply,
    toggleReaction,
    resolveThread,
    deleteThread,
    submitDraftComment,
  };
}
