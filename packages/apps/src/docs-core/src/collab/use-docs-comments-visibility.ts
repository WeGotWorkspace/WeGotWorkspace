import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";

type UseDocsCommentsVisibilityCleanupOptions = {
  commentsVisible: boolean;
  draftThreadRef: MutableRefObject<DocsCommentThread | null>;
  activeThreadIdRef: MutableRefObject<string | null>;
  cancelDraft: () => void;
  clearActiveThread: () => void;
};

export function useDocsCommentsVisibilityCleanup({
  commentsVisible,
  draftThreadRef,
  activeThreadIdRef,
  cancelDraft,
  clearActiveThread,
}: UseDocsCommentsVisibilityCleanupOptions): void {
  useEffect(() => {
    if (commentsVisible) return;
    if (draftThreadRef.current) {
      cancelDraft();
    }
    if (activeThreadIdRef.current != null) {
      clearActiveThread();
    }
  }, [activeThreadIdRef, cancelDraft, clearActiveThread, commentsVisible, draftThreadRef]);
}
