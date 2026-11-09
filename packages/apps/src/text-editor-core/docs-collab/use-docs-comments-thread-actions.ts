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
  /** True once `openThreads` is the server's list for this Doc. */
  threadsLoaded: boolean;
  activeThreadIdRef: MutableRefObject<string | null>;
  dismissedSelectionRef: MutableRefObject<{ from: number; to: number } | null>;
  draftThreadRef: MutableRefObject<DocsCommentThread | null>;
  setActiveThreadId: Dispatch<SetStateAction<string | null>>;
  setDraftThread: Dispatch<SetStateAction<DocsCommentThread | null>>;
  cancelDraft: () => void;
  canMutateComments?: boolean;
};

export function useDocsCommentsThreadActions({
  editor,
  currentUser,
  openThreads,
  openThreadIds,
  threadsLoaded,
  activeThreadIdRef,
  dismissedSelectionRef,
  draftThreadRef,
  setActiveThreadId,
  setDraftThread,
  cancelDraft,
  canMutateComments = true,
}: UseDocsCommentsThreadActionsOptions) {
  // Null until loaded, so a click on a mark never strips the other marks.
  const syncThreads = threadsLoaded ? openThreads : null;
  const activateThreadFromMark = useCallback(
    (threadId: string, clickPos?: number) => {
      markCommentThreadActive(
        threadId,
        activeThreadIdRef,
        dismissedSelectionRef,
        setActiveThreadId,
      );
      if (!editor) return;
      activateCommentThreadInEditor(editor, threadId, syncThreads, clickPos);
    },
    [activeThreadIdRef, dismissedSelectionRef, editor, setActiveThreadId, syncThreads],
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
      selectCommentThreadInEditor(editor, threadId, syncThreads, openThreadIds);
    },
    [
      activeThreadIdRef,
      dismissedSelectionRef,
      editor,
      openThreadIds,
      setActiveThreadId,
      syncThreads,
    ],
  );

  const createThreadFromSelection = useCallback((): string | null => {
    if (!canMutateComments || !editor) return null;
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
  ]);

  return {
    selectThread,
    activateThreadFromMark,
    createThreadFromSelection,
  };
}
