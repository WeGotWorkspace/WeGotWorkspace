import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { ChatMessage, type ChatMessageAction } from "@/chat-ui/src/chat-message";
import { omitChatNestedThreadActions } from "@/chat-ui/src/chat-thread-actions";
import { chatThreadReplyCountLabel } from "@/chat-ui/src/chat-thread-reply-count";
import type {
  ChatAuthorPresenceMap,
  ChatMentionPrincipal,
  ChatMessage as ChatMessageModel,
  ChatSendPayload,
} from "@/chat-ui/src/chat-types";
import { cn } from "@/lib/utils";
import "@/chat-ui/src/chat-ui.css";
import "@/chat-ui/src/chat-thread-panel.css";

export type ChatThreadPanelProps = {
  parent: ChatMessageModel;
  replies?: readonly ChatMessageModel[];
  currentUserId: string;
  title?: string;
  emptyLabel?: string;
  closeLabel?: string;
  onClose?: () => void;
  onSend?: (payload: ChatSendPayload) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  authorPresence?: ChatAuthorPresenceMap;
  actionsForMessage?: (message: ChatMessageModel) => ChatMessageAction[] | undefined;
  mentionPrincipals?: readonly ChatMentionPrincipal[];
  composerPlaceholder?: string;
  composerInitialContent?: string;
  composerDisabled?: boolean;
  /** In-place editor for the thread root (header owns Edit). */
  parentEditing?: boolean;
  parentEditComposer?: ReactNode;
  className?: string;
};

export function ChatThreadPanel({
  parent,
  replies = [],
  currentUserId,
  title = "Thread",
  emptyLabel,
  closeLabel = "Close thread",
  onClose,
  onSend,
  onToggleReaction,
  authorPresence,
  actionsForMessage,
  mentionPrincipals,
  composerPlaceholder = "Reply…",
  composerInitialContent,
  composerDisabled = false,
  parentEditing = false,
  parentEditComposer,
  className,
}: ChatThreadPanelProps) {
  const replyLabel =
    replies.length === 0
      ? (emptyLabel ?? chatThreadReplyCountLabel(0))
      : chatThreadReplyCountLabel(replies.length);

  return (
    <aside className={cn("chat-ui chat-thread-panel", className)} aria-label={title}>
      <header className="chat-thread-panel__header">
        <h2 className="chat-thread-panel__title">{title}</h2>
        {onClose ? (
          <IconButton
            label={closeLabel}
            icon={<X aria-hidden />}
            size="sm"
            variant="ghost"
            showTooltip={false}
            onClick={onClose}
          />
        ) : null}
      </header>
      <div className="chat-thread-panel__scroll">
        <div className="chat-thread-panel__parent">
          <ChatMessage
            message={parent}
            currentUserId={currentUserId}
            editing={parentEditing}
            editComposer={parentEditComposer}
            allowThread={false}
            actions={
              parentEditing ? undefined : omitChatNestedThreadActions(actionsForMessage?.(parent))
            }
            presence={authorPresence?.[parent.authorId]}
            onToggleReaction={
              onToggleReaction ? (emoji) => onToggleReaction(parent.id, emoji) : undefined
            }
          />
        </div>
        <p className="chat-thread-panel__divider">{replyLabel}</p>
        {replies.length > 0 ? (
          <div className="chat-thread-panel__replies">
            {replies.map((reply, index) => {
              const previous = index === 0 ? parent : replies[index - 1];
              return (
                <ChatMessage
                  key={reply.id}
                  message={reply}
                  currentUserId={currentUserId}
                  continuation={previous.authorId === reply.authorId}
                  allowThread={false}
                  actions={omitChatNestedThreadActions(actionsForMessage?.(reply))}
                  presence={authorPresence?.[reply.authorId]}
                  onToggleReaction={
                    onToggleReaction ? (emoji) => onToggleReaction(reply.id, emoji) : undefined
                  }
                />
              );
            })}
          </div>
        ) : null}
      </div>
      {onSend ? (
        <div className="chat-thread-panel__composer">
          <ChatComposer
            principals={mentionPrincipals}
            initialContent={composerInitialContent}
            placeholder={composerPlaceholder}
            disabled={composerDisabled}
            hint={null}
            onSend={onSend}
          />
        </div>
      ) : null}
    </aside>
  );
}
