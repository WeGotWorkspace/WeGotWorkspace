import { useCallback, useRef, type MouseEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { Send, X } from "lucide-react";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/popover";
import { focusTextEditorFromChromeEvent } from "@/text-editor-core/src/text-editor-chrome-focus";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import { getTextEditorContent } from "@/text-editor-core/src/text-editor-content";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";
import { ChatMentionMenu } from "@/chat-ui/src/chat-mention-menu";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { parseChatMentions } from "@/chat-ui/src/chat-mention-utils";
import { ChatMentionNode } from "@/chat-ui/src/chat-mention-node";
import { shouldSendChatOnEnter } from "@/chat-ui/src/chat-send-on-enter";
import type { ChatMentionPrincipal, ChatSendPayload } from "@/lib/models/chat-types";
import { useChatComposerMentions } from "@/chat-ui/src/use-chat-composer-mentions";
import { cn } from "@/lib/utils";
import "@/text-editor-core/src/text-editor.css";
import "@/chat-ui/src/chat-ui.css";
import "@/chat-ui/src/chat-composer.css";

/** Stable across renders: the editor reads its extensions once. */
const CHAT_COMPOSER_EXTENSIONS = [ChatMentionNode];

export type ChatComposerProps = {
  principals?: readonly ChatMentionPrincipal[];
  initialContent?: string;
  placeholder?: string;
  disabled?: boolean;
  onSend: (payload: ChatSendPayload) => void;
  onCancel?: () => void;
  /**
   * Typing activity: `true` on every edit that leaves content in the composer,
   * `false` when it empties, blurs, or a message is sent. Callers throttle.
   */
  onTypingChange?: (typing: boolean) => void;
  /** A text send button ("Comment") instead of the send icon, with its shortcut shown. */
  submitLabel?: string;
  submitShortcut?: string;
  /** Before the input, e.g. the author's avatar. */
  leading?: ReactNode;
  className?: string;
};

export function ChatComposer({
  principals = [],
  initialContent = "",
  placeholder = chatUiLabels.composerPlaceholder,
  disabled = false,
  onSend,
  onCancel,
  onTypingChange,
  submitLabel,
  submitShortcut,
  leading,
  className,
}: ChatComposerProps) {
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const onTypingChangeRef = useRef(onTypingChange);
  onTypingChangeRef.current = onTypingChange;
  const mentionKeyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const editorRef = useRef<Editor | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const submit = useCallback(
    (current: Editor) => {
      const body = getTextEditorContent(current, "markdown").trim();
      if (!body) return;
      onSendRef.current({
        body,
        mentions: parseChatMentions(body, principals),
      });
      current.commands.clearContent();
      onTypingChangeRef.current?.(false);
    },
    [principals],
  );
  // The editor keeps its first `handleKeyDown`; read the latest submit (and
  // so the latest principals) through a ref, or Enter sends no mentions.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const editor = useTextEditor({
    content: initialContent,
    format: "markdown",
    extraExtensions: CHAT_COMPOSER_EXTENSIONS,
    editable: !disabled,
    placeholder,
    onUpdate: ({ content }) => {
      onTypingChangeRef.current?.(content.trim().length > 0);
    },
    editorProps: {
      handleDOMEvents: {
        blur: () => {
          onTypingChangeRef.current?.(false);
          return false;
        },
      },
      handleKeyDown: (_view, event) => {
        if (mentionKeyRef.current(event)) return true;
        if (event.key === "Escape" && onCancelRef.current) {
          event.preventDefault();
          onCancelRef.current();
          return true;
        }
        const current = editorRef.current;
        // Enter sends everywhere (Chat, Meet, task and Docs comments);
        // Shift+Enter starts a new line.
        if (current && shouldSendChatOnEnter(event)) {
          event.preventDefault();
          submitRef.current(current);
          return true;
        }
        return false;
      },
    },
  });
  editorRef.current = editor;

  const mentions = useChatComposerMentions(editor, principals);
  mentionKeyRef.current = mentions.onMenuKeyDown;

  const onCardMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    focusTextEditorFromChromeEvent(event, editor);
  };

  // One line to start, growing with the text. Markdown comes from typing (`**bold**`,
  // `- list`) and the editor shortcuts; there is no format bar.
  return (
    <div
      className={cn("chat-ui chat-composer", leading ? "chat-composer--leading" : null, className)}
    >
      {leading ? <div className="chat-composer__leading">{leading}</div> : null}
      <Popover
        open={mentions.query !== null}
        onOpenChange={(open) => {
          if (!open) mentions.dismiss();
        }}
      >
        <PopoverAnchor asChild>
          <div ref={cardRef} className="chat-composer__card" onMouseDown={onCardMouseDown}>
            <div className="chat-composer__row">
              <div className="chat-composer__sheet">
                <TextEditorSheet editor={editor} variant="inline" />
              </div>
              {onCancel ? (
                <IconButton
                  label={chatUiLabels.cancel}
                  icon={<X />}
                  size="md"
                  variant="ghost"
                  onClick={onCancel}
                  disabled={disabled}
                />
              ) : null}
              {submitLabel ? (
                <Button
                  className="chat-composer__submit"
                  variant="outline"
                  size="md"
                  onClick={() => {
                    if (editor) submit(editor);
                  }}
                  disabled={disabled}
                  aria-keyshortcuts="Enter"
                >
                  {submitLabel}
                  {submitShortcut ? (
                    <kbd className="chat-composer__shortcut" aria-hidden>
                      {submitShortcut}
                    </kbd>
                  ) : null}
                </Button>
              ) : (
                <IconButton
                  label={chatUiLabels.send}
                  icon={<Send />}
                  size="md"
                  variant="ghost"
                  onClick={() => {
                    if (editor) submit(editor);
                  }}
                  disabled={disabled}
                />
              )}
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          frost
          side="top"
          align="start"
          sideOffset={8}
          className="chat-composer__mentions"
          // The caret stays in the composer: typing keeps filtering the list.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // A click in the composer itself moves the caret; it is not "outside".
          onInteractOutside={(event) => {
            const target = event.target as Node | null;
            if (target && cardRef.current?.contains(target)) event.preventDefault();
          }}
        >
          {mentions.query ? (
            <ChatMentionMenu
              principals={principals}
              query={mentions.query.query}
              open
              activeIndex={mentions.activeIndex}
              onSelect={mentions.selectPrincipal}
            />
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
