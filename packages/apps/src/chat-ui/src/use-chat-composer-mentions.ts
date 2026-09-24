import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { ChatMentionPrincipal } from "@/chat-ui/src/chat-types";
import {
  extractChatMentionQuery,
  filterChatMentionPrincipals,
  type ChatMentionQuery,
} from "@/chat-ui/src/chat-mention-utils";

export type ChatComposerMentionState = {
  query: ChatMentionQuery | null;
  matches: ChatMentionPrincipal[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  selectPrincipal: (principal: ChatMentionPrincipal) => void;
  onMenuKeyDown: (event: KeyboardEvent) => boolean;
};

function textBeforeCursor(editor: Editor): string {
  const { from } = editor.state.selection;
  return editor.state.doc.textBetween(0, from, "\n", "\n");
}

export function useChatComposerMentions(
  editor: Editor | null,
  principals: readonly ChatMentionPrincipal[],
): ChatComposerMentionState {
  const [query, setQuery] = useState<ChatMentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = query ? filterChatMentionPrincipals(principals, query.query) : [];

  useEffect(() => {
    if (!editor) return undefined;

    const sync = () => {
      const next = extractChatMentionQuery(textBeforeCursor(editor));
      setQuery(next);
      setActiveIndex(0);
    };

    sync();
    editor.on("update", sync);
    editor.on("selectionUpdate", sync);
    return () => {
      editor.off("update", sync);
      editor.off("selectionUpdate", sync);
    };
  }, [editor]);

  const selectPrincipal = useCallback(
    (principal: ChatMentionPrincipal) => {
      if (!editor || !query) return;
      const cursor = editor.state.selection.from;
      const tokenLength = query.end - query.start;
      editor
        .chain()
        .focus()
        .deleteRange({ from: cursor - tokenLength, to: cursor })
        .insertContent(`@${principal.displayName} `)
        .run();
      setQuery(null);
    },
    [editor, query],
  );

  const onMenuKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!query || matches.length === 0) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % matches.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const match = matches[activeIndex];
        if (!match) return false;
        event.preventDefault();
        selectPrincipal(match);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setQuery(null);
        return true;
      }
      return false;
    },
    [activeIndex, matches, query, selectPrincipal],
  );

  return { query, matches, activeIndex, setActiveIndex, selectPrincipal, onMenuKeyDown };
}
