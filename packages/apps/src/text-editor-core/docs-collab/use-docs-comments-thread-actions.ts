import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import type * as Y from "yjs";
import {
  activateCommentThreadInEditor,
  markCommentThreadActive,
  selectCommentThreadInEditor,
} from "./docs-comments/docs-comments-editor-actions";
import {
  buildDraftThreadFromSelection,
  selectionOverlapsOpenComment,
} from "./docs-comments/docs-comments-map-writes";
import type { DocsCommentAuthor, DocsCommentThread } from "./docs-comments-types";

type UseDocsCommentsThreadActionsOptions = {
  ydoc: Y.Doc | null;
  editor: Editor | null;
  currentUser: DocsCommentAuthor;
  openThreads: DocsCommentThread[];
  openThreadIds: Set<string>;
  activeThreadIdRef: MutableRefObject<string | null>;
  dismissedSelectionRef: MutableRefObject<{ from: number; to: number } | null>;
  draftThreadRef: MutableRefObject<DocsCommentThread | null>;
  setActiveThreadId: Dispatch<SetStateAction<string | null>>;
  setDraftThread: Dispatch<SetStateAction<DocsCommentThread | null>>;
  cancelDraft: () => void;
  canMutateComments?: boolean;
};

export function useDocsCommentsThreadActions({
  ydoc,
  editor,
  currentUser,
  openThreads,
  openThreadIds,
  activeThreadIdRef,
  dismissedSelectionRef,
  draftThreadRef,
  setActiveThreadId,
  setDraftThread,
  cancelDraft,
  canMutateComments = true,
}: UseDocsCommentsThreadActionsOptions) {
  const activateThreadFromMark = useCallback(
    (threadId: string, clickPos?: number) => {
      markCommentThreadActive(
        threadId,
        activeThreadIdRef,
        dismissedSelectionRef,
        setActiveThreadId,
      );
      if (!editor) return;
      activateCommentThreadInEditor(editor, threadId, openThreads, clickPos);
    },
    [activeThreadIdRef, dismissedSelectionRef, editor, openThreads, setActiveThreadId],
  );

  const selectThread = useCallback(
    (threadId: string) => {
      markCommentThreadActive(
        threadId,
        activeThreadIdRef,
        dismissedSelectionRef,
        setActiveThreadId,
      );
      if (!editor) return;
      selectCommentThreadInEditor(editor, threadId, openThreads, openThreadIds);
    },
    [
      activeThreadIdRef,
      dismissedSelectionRef,
      editor,
      openThreadIds,
      openThreads,
      setActiveThreadId,
    ],
  );

  const createThreadFromSelection = useCallback((): string | null => {
    if (!canMutateComments || !ydoc || !editor) return null;
    if (selectionOverlapsOpenComment(editor, openThreadIds)) return null;

    if (draftThreadRef.current) {
      cancelDraft();
    }

    const thread = buildDraftThreadFromSelection(editor, currentUser);
    if (!thread) return null;

    draftThreadRef.current = thread;
    setDraftThread(thread);
    setActiveThreadId(thread.id);
    return thread.id;
  }, [
    canMutateComments,
    cancelDraft,
    currentUser,
    draftThreadRef,
    editor,
    openThreadIds,
    setActiveThreadId,
    setDraftThread,
    ydoc,
  ]);

  return {
    selectThread,
    activateThreadFromMark,
    createThreadFromSelection,
  };
}
