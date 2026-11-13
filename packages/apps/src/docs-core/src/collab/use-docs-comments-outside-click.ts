import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { Editor } from "@tiptap/react";
import { isDocsCommentUiTarget } from "./docs-comments/docs-comments-ui-target";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";

type UseDocsCommentsOutsideClickOptions = {
  editor: Editor | null;
  activeThreadId: string | null;
  draftThreadRef: MutableRefObject<DocsCommentThread | null>;
  clearActiveThread: () => void;
};

export function useDocsCommentsOutsideClick({
  editor,
  activeThreadId,
  draftThreadRef,
  clearActiveThread,
}: UseDocsCommentsOutsideClickOptions): void {
  useEffect(() => {
    if (!editor || editor.isDestroyed || activeThreadId == null || draftThreadRef.current) {
      return;
    }

    let pendingOutsideClear = false;

    const handlePointerDown = (event: PointerEvent) => {
      if (isDocsCommentUiTarget(event.target, event.clientX, event.clientY)) {
        pendingOutsideClear = false;
        return;
      }
      pendingOutsideClear = true;
    };

    const handleClick = (event: MouseEvent) => {
      if (isDocsCommentUiTarget(event.target, event.clientX, event.clientY)) {
        pendingOutsideClear = false;
        return;
      }
      if (!pendingOutsideClear) return;
      pendingOutsideClear = false;
      clearActiveThread();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [activeThreadId, clearActiveThread, draftThreadRef, editor]);
}
