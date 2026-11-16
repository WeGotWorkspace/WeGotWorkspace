import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { setSuggestionActiveId } from "@/text-editor-core/src/text-editor-suggestion-active";

export type DocsSuggestionsActiveState = {
  activeChangeId: string | null;
  setActiveChangeId: Dispatch<SetStateAction<string | null>>;
  clearActiveSuggestion: () => void;
};

/** Sidebar active state; editor highlight via decoration plugin (no focus/selection). */
export function useDocsSuggestionsActive(editor: Editor | null): DocsSuggestionsActiveState {
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null);

  useEffect(() => {
    if (!editor) return;
    setSuggestionActiveId(editor, activeChangeId);
  }, [activeChangeId, editor]);

  const clearActiveSuggestion = useCallback(() => {
    setActiveChangeId(null);
    if (editor && !editor.isDestroyed) {
      setSuggestionActiveId(editor, null);
    }
  }, [editor]);

  return {
    activeChangeId,
    setActiveChangeId,
    clearActiveSuggestion,
  };
}
