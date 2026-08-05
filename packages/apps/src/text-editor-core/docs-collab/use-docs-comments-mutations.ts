import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import type * as Y from "yjs";
import {
  appendCommentReply,
  createCommentMessage,
  deletePersistedCommentThread,
  persistDraftThreadFirstReply,
  resolveCommentThread,
  toggleCommentThreadReaction,
} from "./docs-comments/docs-comments-map-writes";
import type { DocsCommentAuthor, DocsCommentThread } from "./docs-comments-types";

type UseDocsCommentsMutationsOptions = {
  ydoc: Y.Doc | null;
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
  ydoc,
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
      if (!canMutateComments || !ydoc) return;

      const message = createCommentMessage(body, currentUser);
      if (!message) return;

      const draft = draftThreadRef.current;
      if (draft?.id === threadId) {
        persistDraftThreadFirstReply(ydoc, draft, message);
        draftThreadRef.current = null;
        setDraftThread(null);
        return;
      }

      appendCommentReply(ydoc, threadId, message);
    },
    [canMutateComments, currentUser, draftThreadRef, setDraftThread, ydoc],
  );

  const toggleReaction = useCallback(
    (threadId: string, emoji: string) => {
      if (!canMutateComments || !ydoc) return;
      toggleCommentThreadReaction(ydoc, threadId, currentUser.id, emoji);
    },
    [canMutateComments, currentUser.id, ydoc],
  );

  const resolveThread = useCallback(
    (threadId: string) => {
      if (!canMutateComments || !ydoc) return;
      if (!resolveCommentThread(ydoc, threadId)) return;

      editor?.commands.unsetComment(threadId);
      if (activeThreadId === threadId) setActiveThreadId(null);
    },
    [activeThreadId, canMutateComments, editor, setActiveThreadId, ydoc],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      if (!canMutateComments) return;
      if (draftThreadRef.current?.id === threadId) {
        cancelDraft();
        return;
      }
      if (!ydoc) return;

      deletePersistedCommentThread(ydoc, threadId);
      editor?.commands.unsetComment(threadId);
      if (activeThreadId === threadId) setActiveThreadId(null);
    },
    [
      activeThreadId,
      canMutateComments,
      cancelDraft,
      draftThreadRef,
      editor,
      setActiveThreadId,
      ydoc,
    ],
  );

  const submitDraftComment = useCallback(
    (body: string) => {
      const draft = draftThreadRef.current;
      if (!draft) return;
      addReply(draft.id, body);
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
