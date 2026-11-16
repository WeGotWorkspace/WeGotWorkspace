import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { MutableRefObject } from "react";
import {
  findCommentMarkIdInSelection,
  readSelectedAnchorText,
} from "@/text-editor-core/src/text-editor-comment-commands";
import { shouldOfferCommentCompose } from "./docs-comments/docs-comments-selection-gate";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";

export type DocsCommentsSelectionState = {
  isSelectingText: boolean;
  selectionQualifiesForComment: boolean;
};

type UseDocsCommentsSelectionOptions = {
  editor: Editor | null;
  commentsVisible: boolean;
  selectionVersion: number;
  bumpSelectionVersion: () => void;
  openThreadIds: Set<string>;
  draftThreadRef: MutableRefObject<DocsCommentThread | null>;
  activeThreadIdRef: MutableRefObject<string | null>;
  dismissedSelectionRef: MutableRefObject<{ from: number; to: number } | null>;
  activateThreadFromMark: (threadId: string, clickPos?: number) => void;
};

export function useDocsCommentsSelection({
  editor,
  commentsVisible,
  selectionVersion,
  bumpSelectionVersion,
  openThreadIds,
  draftThreadRef,
  activeThreadIdRef,
  dismissedSelectionRef,
  activateThreadFromMark,
}: UseDocsCommentsSelectionOptions): DocsCommentsSelectionState {
  const [isSelectingText, setIsSelectingText] = useState(false);

  useEffect(() => {
    if (!editor) return;
    editor.on("selectionUpdate", bumpSelectionVersion);
    return () => {
      editor.off("selectionUpdate", bumpSelectionVersion);
    };
  }, [bumpSelectionVersion, editor]);

  useEffect(() => {
    if (!editor) {
      setIsSelectingText(false);
      return;
    }

    const dom = editor.view.dom;
    const onPointerDown = () => setIsSelectingText(true);
    const onPointerUp = () => {
      requestAnimationFrame(() => {
        setIsSelectingText(false);
        bumpSelectionVersion();
      });
    };

    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [bumpSelectionVersion, editor]);

  const selectionQualifiesForComment = useMemo(() => {
    if (!editor) return false;
    void selectionVersion;
    if (draftThreadRef.current) return false;
    if (findCommentMarkIdInSelection(editor, { allowedIds: openThreadIds })) return false;
    return shouldOfferCommentCompose({
      isSelecting: isSelectingText,
      anchorText: readSelectedAnchorText(editor),
    });
  }, [draftThreadRef, editor, isSelectingText, openThreadIds, selectionVersion]);

  useEffect(() => {
    if (!commentsVisible || !editor || draftThreadRef.current || isSelectingText) return;
    void selectionVersion;

    const { from, to, empty } = editor.state.selection;
    const dismissed = dismissedSelectionRef.current;
    if (dismissed && dismissed.from === from && dismissed.to === to) {
      return;
    }
    if (dismissed) {
      dismissedSelectionRef.current = null;
    }

    const existingId = findCommentMarkIdInSelection(editor, { allowedIds: openThreadIds });
    // Collapsed caret traversal should not activate threads; only non-empty selection or explicit clicks.
    if (empty || !existingId) return;
    if (activeThreadIdRef.current === existingId) {
      editor.commands.selectComment(existingId, { caretPos: editor.state.selection.$anchor.pos });
      return;
    }

    activateThreadFromMark(existingId);
  }, [
    activateThreadFromMark,
    activeThreadIdRef,
    commentsVisible,
    dismissedSelectionRef,
    draftThreadRef,
    editor,
    isSelectingText,
    openThreadIds,
    selectionVersion,
  ]);

  return {
    isSelectingText,
    selectionQualifiesForComment,
  };
}
