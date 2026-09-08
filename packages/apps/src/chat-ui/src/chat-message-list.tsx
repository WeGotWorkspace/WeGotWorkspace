import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/button/src/button";
import { ChatMessage, type ChatMessageAction } from "@/chat-ui/src/chat-message";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { groupChatMessages, groupChatMessagesByDay } from "@/chat-ui/src/chat-message-group";
import type {
  ChatAuthorPresenceMap,
  ChatMessage as ChatMessageModel,
} from "@/chat-ui/src/chat-types";
import { ListStickyHeader } from "@/list-sticky-header/src/list-sticky-header";
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
  allowThread?: boolean;
  onCaughtUpChange?: (caughtUp: boolean) => void;
};

const STICK_THRESHOLD_PX = 48;

function isNearBottom(el: HTMLDivElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
}

function scrollToBottom(el: HTMLDivElement, ignoreScrollRef: { current: boolean }): void {
  ignoreScrollRef.current = true;
  el.scrollTop = el.scrollHeight;
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
    ignoreScrollRef.current = false;
  });
}

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
  allowThread = true,
  onCaughtUpChange,
}: ChatMessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const ignoreScrollRef = useRef(false);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const onCaughtUpChangeRef = useRef(onCaughtUpChange);
  onCaughtUpChangeRef.current = onCaughtUpChange;
  const caughtUpNotifiedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const groups = groupChatMessages(messages);
  const daySections = groupChatMessagesByDay(groups);

  function notifyCaughtUp(next: boolean): void {
    if (caughtUpNotifiedRef.current === next) return;
    caughtUpNotifiedRef.current = next;
    onCaughtUpChangeRef.current?.(next);
  }

  function onScroll(): void {
    if (ignoreScrollRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = isNearBottom(el);
    stickRef.current = atBottom;
    if (atBottom) {
      setShowJump(false);
      notifyCaughtUp(true);
      return;
    }
    notifyCaughtUp(false);
  }

  function jumpToLatest(): void {
    stickRef.current = true;
    setShowJump(false);
    notifyCaughtUp(true);
    const el = scrollerRef.current;
    if (el) scrollToBottom(el, ignoreScrollRef);
  }

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const last = messages.at(-1);
    const lastId = last?.id;
    const previousId = lastMessageIdRef.current;
    lastMessageIdRef.current = lastId;
    const appended = Boolean(lastId && lastId !== previousId && previousId !== undefined);
    const ownSend = appended && last?.authorId === currentUserId;

    if (ownSend) {
      stickRef.current = true;
      setShowJump(false);
      notifyCaughtUp(true);
    } else if (appended && !stickRef.current) {
      setShowJump(true);
    }

    const stickToBottom = () => {
      if (!stickRef.current) return;
      scrollToBottom(el, ignoreScrollRef);
    };

    stickToBottom();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(stickToBottom);
    observer.observe(el);
    for (const child of el.children) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [messages, currentUserId]);

  return (
    <div className={cn("chat-ui chat-message-list", className)}>
      {messages.length === 0 ? (
        <p className="chat-message-list__empty">{emptyLabel}</p>
      ) : (
        <>
          <div
            ref={scrollerRef}
            className="chat-message-list__scroll"
            onScroll={onScroll}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {daySections.map((day) => (
              <section
                key={day.key}
                className="chat-message-list__day-section"
                aria-labelledby={`chat-day-${day.key}`}
              >
                <ListStickyHeader
                  id={`chat-day-${day.key}`}
                  label={day.label}
                  emphasis={day.emphasis}
                  rest={day.rest}
                />
                {day.groups.map((group) => (
                  <div key={group.id} className="chat-message-list__group">
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
                        allowThread={allowThread}
                        onOpenThread={onOpenThread ? () => onOpenThread(message) : undefined}
                        onToggleReaction={
                          onToggleReaction
                            ? (emoji) => onToggleReaction(message.id, emoji)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </div>
          {showJump ? (
            <Button
              className="chat-message-list__jump"
              label={chatUiLabels.newMessages}
              size="sm"
              pill
              variant="primary"
              onClick={jumpToLatest}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
