import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { setCommentActiveId } from "@/text-editor-core/src/text-editor-comment-commands";

export type DocsCommentsActiveState = {
  activeThreadId: string | null;
  activeThreadIdRef: MutableRefObject<string | null>;
  dismissedSelectionRef: MutableRefObject<{ from: number; to: number } | null>;
  setActiveThreadId: Dispatch<SetStateAction<string | null>>;
  clearActiveThread: () => void;
};

export function useDocsCommentsActive(editor: Editor | null): DocsCommentsActiveState {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const dismissedSelectionRef = useRef<{ from: number; to: number } | null>(null);
  activeThreadIdRef.current = activeThreadId;

  useEffect(() => {
    if (!editor) return;
    setCommentActiveId(editor, activeThreadIdRef.current);
  }, [activeThreadId, editor]);

  const clearActiveThread = useCallback(() => {
    if (editor && !editor.isDestroyed) {
      const { from, to } = editor.state.selection;
      dismissedSelectionRef.current = { from, to };
    } else {
      dismissedSelectionRef.current = null;
    }
    activeThreadIdRef.current = null;
    setActiveThreadId(null);
    if (editor && !editor.isDestroyed) {
      setCommentActiveId(editor, null);
    }
  }, [editor]);

  return {
    activeThreadId,
    activeThreadIdRef,
    dismissedSelectionRef,
    setActiveThreadId,
    clearActiveThread,
  };
}
