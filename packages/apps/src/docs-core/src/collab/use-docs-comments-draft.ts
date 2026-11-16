import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { setCommentDraftAnchor } from "@/text-editor-core/src/text-editor-comment-draft-anchor";
import { selectionMatchesDraftAnchor } from "./docs-comments/docs-comments-draft-utils";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";

export type DocsCommentsDraftState = {
  draftThread: DocsCommentThread | null;
  draftThreadRef: MutableRefObject<DocsCommentThread | null>;
  setDraftThread: Dispatch<SetStateAction<DocsCommentThread | null>>;
  cancelDraft: () => void;
};

type UseDocsCommentsDraftOptions = {
  editor: Editor | null;
  commentsVisible: boolean;
  bumpSelectionVersion: () => void;
  setActiveThreadId: Dispatch<SetStateAction<string | null>>;
};

export function useDocsCommentsDraft({
  editor,
  commentsVisible,
  bumpSelectionVersion,
  setActiveThreadId,
}: UseDocsCommentsDraftOptions): DocsCommentsDraftState {
  const [draftThread, setDraftThread] = useState<DocsCommentThread | null>(null);
  const draftThreadRef = useRef<DocsCommentThread | null>(null);

  useEffect(() => {
    draftThreadRef.current = draftThread;
  }, [draftThread]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !commentsVisible) {
      if (editor && !editor.isDestroyed) setCommentDraftAnchor(editor, null);
      return;
    }

    const draft = draftThread;
    if (draft && typeof draft.anchorFrom === "number" && typeof draft.anchorTo === "number") {
      setCommentDraftAnchor(editor, { from: draft.anchorFrom, to: draft.anchorTo });
      return () => setCommentDraftAnchor(editor, null);
    }

    setCommentDraftAnchor(editor, null);
    return () => setCommentDraftAnchor(editor, null);
  }, [commentsVisible, draftThread, editor]);

  const cancelDraft = useCallback(() => {
    const draft = draftThreadRef.current;
    if (!draft || !editor) return;
    const { to, empty } = editor.state.selection;
    draftThreadRef.current = null;
    setDraftThread(null);
    setActiveThreadId((current) => (current === draft.id ? null : current));
    if (!empty) {
      editor.commands.setTextSelection(to);
    }
    bumpSelectionVersion();
  }, [bumpSelectionVersion, editor, setActiveThreadId]);

  useEffect(() => {
    if (!editor) return;

    const maybeCancelDraft = () => {
      const draft = draftThreadRef.current;
      if (!draft) return;
      if (selectionMatchesDraftAnchor(editor, draft)) return;

      requestAnimationFrame(() => {
        const pending = draftThreadRef.current;
        if (!pending) return;
        if (selectionMatchesDraftAnchor(editor, pending)) return;

        const active = document.activeElement;
        if (active?.closest(".docs-comments-floating-layer")) return;

        cancelDraft();
      });
    };

    editor.on("selectionUpdate", maybeCancelDraft);
    return () => {
      editor.off("selectionUpdate", maybeCancelDraft);
    };
  }, [cancelDraft, editor]);

  return {
    draftThread,
    draftThreadRef,
    setDraftThread,
    cancelDraft,
  };
}
