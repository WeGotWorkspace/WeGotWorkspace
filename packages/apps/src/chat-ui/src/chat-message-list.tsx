import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ChatMessage, type ChatMessageAction } from "@/chat-ui/src/chat-message";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import {
  chatMessageDayKey,
  formatChatDayLabel,
  groupChatMessages,
} from "@/chat-ui/src/chat-message-group";
import type {
  ChatAuthorPresenceMap,
  ChatMessage as ChatMessageModel,
} from "@/chat-ui/src/chat-types";
import { cn } from "@/lib/utils";
import "@/chat-ui/src/chat-ui.css";
import "@/chat-ui/src/chat-message-list.css";

export type ChatMessageListProps = {
  messages: readonly ChatMessageModel[];
  currentUserId: string;
  emptyLabel?: string;
  actionsForMessage?: (message: ChatMessageModel) => ChatMessageAction[] | undefined;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onOpenThread?: (message: ChatMessageModel) => void;
  authorPresence?: ChatAuthorPresenceMap;
  editingMessageId?: string | null;
  editComposer?: (message: ChatMessageModel) => ReactNode;
  className?: string;
};

const STICK_THRESHOLD_PX = 48;

export function ChatMessageList({
  messages,
  currentUserId,
  emptyLabel = chatUiLabels.empty,
  actionsForMessage,
  onToggleReaction,
  onOpenThread,
  authorPresence,
  editingMessageId,
  editComposer,
  className,
}: ChatMessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const ignoreScrollRef = useRef(false);
  const groups = groupChatMessages(messages);

  function onScroll(): void {
    if (ignoreScrollRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const stickToBottom = () => {
      if (!stickRef.current) return;
      ignoreScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
        ignoreScrollRef.current = false;
      });
    };

    stickToBottom();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(stickToBottom);
    observer.observe(el);
    for (const child of el.children) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [messages]);

  return (
    <div className={cn("chat-ui chat-message-list", className)}>
      {messages.length === 0 ? (
        <p className="chat-message-list__empty">{emptyLabel}</p>
      ) : (
        <div
          ref={scrollerRef}
          className="chat-message-list__scroll"
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {groups.map((group, groupIndex) => {
            const previous = groups[groupIndex - 1];
            const dayKey = chatMessageDayKey(group.messages[0]!.createdAt);
            const previousDay = previous
              ? chatMessageDayKey(previous.messages[0]!.createdAt)
              : null;
            const showDay = dayKey !== previousDay;
            return (
              <div key={group.id} className="chat-message-list__group">
                {showDay ? (
                  <div className="chat-message-list__day">
                    <span className="chat-message-list__day-label">
                      {formatChatDayLabel(group.messages[0]!.createdAt)}
                    </span>
                  </div>
                ) : null}
                {group.messages.map((message, index) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    currentUserId={currentUserId}
                    continuation={index > 0}
                    editing={editingMessageId === message.id}
                    editComposer={
                      editingMessageId === message.id ? editComposer?.(message) : undefined
                    }
                    actions={actionsForMessage?.(message)}
                    presence={authorPresence?.[message.authorId]}
                    onOpenThread={onOpenThread ? () => onOpenThread(message) : undefined}
                    onToggleReaction={
                      onToggleReaction ? (emoji) => onToggleReaction(message.id, emoji) : undefined
                    }
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
