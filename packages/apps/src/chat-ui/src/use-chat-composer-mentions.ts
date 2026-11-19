import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { ChatMentionPrincipal } from "@/lib/models/chat-types";
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
  /** Close the menu for the `@` being typed (Esc, a click outside); a new `@` opens it again. */
  dismiss: () => void;
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
  const [rawQuery, setQuery] = useState<ChatMentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Where the dismissed `@` starts: that token stays closed, another one opens.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const query = rawQuery && rawQuery.start !== dismissedAt ? rawQuery : null;
  const matches = query ? filterChatMentionPrincipals(principals, query.query) : [];

  useEffect(() => {
    if (!editor) return undefined;

    const sync = () => {
      const next = extractChatMentionQuery(textBeforeCursor(editor));
      setQuery(next);
      setActiveIndex(0);
      if (!next) setDismissedAt(null);
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
        .insertContent([
          { type: "chatMention", attrs: { id: principal.id, label: principal.displayName } },
          { type: "text", text: " " },
        ])
        .run();
      setQuery(null);
    },
    [editor, query],
  );

  const dismiss = useCallback(() => {
    setDismissedAt(rawQuery?.start ?? null);
  }, [rawQuery]);

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
        // Only the menu closes: the composer keeps focus and the draft.
        event.stopPropagation();
        dismiss();
        return true;
      }
      return false;
    },
    [activeIndex, dismiss, matches, query, selectPrincipal],
  );

  return {
    query,
    matches,
    activeIndex,
    setActiveIndex,
    selectPrincipal,
    dismiss,
    onMenuKeyDown,
  };
}
