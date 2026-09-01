import { useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { Send, X } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { TextEditorFormatBar } from "@/text-editor-core/src/text-editor-format-bar";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import { getTextEditorContent } from "@/text-editor-core/src/text-editor-content";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";
import { ChatMentionMenu } from "@/chat-ui/src/chat-mention-menu";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { parseChatMentions } from "@/chat-ui/src/chat-mention-utils";
import { shouldSendChatOnEnter } from "@/chat-ui/src/chat-send-on-enter";
import type { ChatMentionPrincipal, ChatSendPayload } from "@/chat-ui/src/chat-types";
import { useChatComposerMentions } from "@/chat-ui/src/use-chat-composer-mentions";
import { cn } from "@/lib/utils";
import "@/text-editor-core/src/text-editor.css";
import "@/chat-ui/src/chat-ui.css";
import "@/chat-ui/src/chat-composer.css";

export type ChatComposerProps = {
  principals?: readonly ChatMentionPrincipal[];
  initialContent?: string;
  placeholder?: string;
  disabled?: boolean;
  onSend: (payload: ChatSendPayload) => void;
  onCancel?: () => void;
  /** Caption under the card. Pass `null` to hide (e.g. inline edit). */
  hint?: string | null;
  className?: string;
};

export function ChatComposer({
  principals = [],
  initialContent = "",
  placeholder = chatUiLabels.composerPlaceholder,
  disabled = false,
  onSend,
  onCancel,
  hint = chatUiLabels.sendHint,
  className,
}: ChatComposerProps) {
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const mentionKeyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const editorRef = useRef<Editor | null>(null);

  const submit = useCallback(
    (current: Editor) => {
      const body = getTextEditorContent(current, "markdown").trim();
      if (!body) return;
      onSendRef.current({
        body,
        mentions: parseChatMentions(body, principals),
      });
      current.commands.clearContent();
    },
    [principals],
  );

  const editor = useTextEditor({
    content: initialContent,
    format: "markdown",
    editable: !disabled,
    placeholder,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (mentionKeyRef.current(event)) return true;
        if (event.key === "Escape" && onCancelRef.current) {
          event.preventDefault();
          onCancelRef.current();
          return true;
        }
        const current = editorRef.current;
        if (current && shouldSendChatOnEnter(event)) {
          event.preventDefault();
          submit(current);
          return true;
        }
        return false;
      },
    },
  });
  editorRef.current = editor;

  const mentions = useChatComposerMentions(editor, principals);
  mentionKeyRef.current = mentions.onMenuKeyDown;

  return (
    <div className={cn("chat-ui chat-composer", className)}>
      <div className="chat-composer__card">
        <TextEditorFormatBar
          editor={editor}
          groups={["marksBasic", "blocksBasic", "link"]}
          showPrint={false}
          formattingDisabled={disabled}
          className="chat-composer__bar"
        />
        <div className="chat-composer__sheet">
          <TextEditorSheet editor={editor} variant="inline" slashMenu={false} />
        </div>
        {mentions.query ? (
          <div className="chat-composer__mentions">
            <ChatMentionMenu
              principals={principals}
              query={mentions.query.query}
              open
              activeIndex={mentions.activeIndex}
              onSelect={mentions.selectPrincipal}
            />
          </div>
        ) : null}
        <div className="chat-composer__footer">
          {onCancel ? (
            <IconButton
              label={chatUiLabels.cancel}
              icon={<X />}
              size="sm"
              variant="ghost"
              onClick={onCancel}
              disabled={disabled}
            />
          ) : null}
          <IconButton
            label={chatUiLabels.send}
            icon={<Send />}
            size="sm"
            variant="ghost"
            onClick={() => {
              if (editor) submit(editor);
            }}
            disabled={disabled}
          />
        </div>
      </div>
      {hint ? <p className="chat-composer__hint">{hint}</p> : null}
    </div>
  );
}
