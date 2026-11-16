import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/button/src/button";
import { CollectionState } from "@/collection-state/src/collection-state";
import type { ChatMessageAction } from "@/chat-ui/src/chat-message";
import { ChatMessageRow } from "@/chat-ui/src/chat-message-row";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import {
  chatListItemIsHeader,
  chatListItemKey,
  chatListItems,
  chatListTodayKey,
  estimateChatListItem,
  type ChatListItem,
} from "@/chat-ui/src/chat-message-list-items";
import type {
  ChatAuthorPresenceMap,
  ChatMessage as ChatMessageModel,
} from "@/lib/models/chat-types";
import { markdownToPlainText } from "@/lib/models/note-body-markdown";
import { ListStickyHeader } from "@/list-sticky-header/src/list-sticky-header";
import { useWorkspaceListRows } from "@/workspace-list/src/use-workspace-list-rows";
import { cn } from "@/lib/utils";
import "@/chat-ui/src/chat-ui.css";
import "@/chat-ui/src/chat-message-list.css";

export type ChatMessageListProps = {
  messages: readonly ChatMessageModel[];
  currentUserId: string;
  emptyLabel?: string;
  /**
   * The hover actions of a message. Rows are memoized: which actions show may depend on
   * the message and `currentUserId` only. Their handlers may change: a click runs the
   * handler from the latest `actionsForMessage`.
   */
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
/** Earlier announcements kept in the live region; older ones were read already. */
const ANNOUNCEMENTS_KEPT = 5;

type Announcement = { id: string; text: string };

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

/**
 * The messages after `previousId`: what arrived since the last render. None when
 * that message is gone (deleted, or replaced): the new last one is not news.
 */
function messagesAfter(
  messages: readonly ChatMessageModel[],
  previousId: string,
): ChatMessageModel[] {
  const at = messages.findIndex((message) => message.id === previousId);
  return at < 0 ? [] : messages.slice(at + 1);
}

function announcementFor(message: ChatMessageModel): Announcement {
  return { id: message.id, text: `${message.authorName}: ${markdownToPlainText(message.body)}` };
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
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const dayIdPrefix = useId();
  const stickRef = useRef(true);
  const ignoreScrollRef = useRef(false);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const onCaughtUpChangeRef = useRef(onCaughtUpChange);
  onCaughtUpChangeRef.current = onCaughtUpChange;
  const caughtUpNotifiedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  const todayKey = chatListTodayKey();
  // `todayKey` relabels Today / Yesterday after midnight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => chatListItems(messages), [messages, todayKey]);

  // Rows keep stable handlers, so they skip re-rendering; a click calls the latest prop.
  const latest = useRef({ actionsForMessage, onToggleReaction, onOpenThread });
  latest.current = { actionsForMessage, onToggleReaction, onOpenThread };
  // A row builds its actions when it renders; each click looks its action up again.
  const actionsFor = useCallback(
    (message: ChatMessageModel) =>
      latest.current.actionsForMessage?.(message)?.map((action) => ({
        ...action,
        onClick: () =>
          latest.current
            .actionsForMessage?.(message)
            ?.find((next) => next.id === action.id)
            ?.onClick(),
      })),
    [],
  );
  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => latest.current.onToggleReaction?.(messageId, emoji),
    [],
  );
  const openThread = useCallback(
    (message: ChatMessageModel) => latest.current.onOpenThread?.(message),
    [],
  );

  const dayHeaderId = useCallback((key: string) => `${dayIdPrefix}chat-day-${key}`, [dayIdPrefix]);
  const renderItem = (item: ChatListItem) => {
    if (item.kind === "day") {
      return (
        <ListStickyHeader
          id={dayHeaderId(item.day.key)}
          label={item.day.label}
          emphasis={item.day.emphasis}
          rest={item.day.rest}
          variant="frost"
        />
      );
    }
    const { message } = item;
    const editing = editingMessageId === message.id;
    return (
      <ChatMessageRow
        message={message}
        currentUserId={currentUserId}
        continuation={item.continuation}
        beforeContinuation={item.beforeContinuation}
        groupStart={item.groupStart}
        editing={editing}
        editComposer={editing ? editComposer?.(message) : undefined}
        presence={authorPresence?.[message.authorId]}
        allowThread={allowThread}
        actionsFor={actionsForMessage ? actionsFor : undefined}
        toggleReaction={onToggleReaction ? toggleReaction : undefined}
        openThread={onOpenThread ? openThread : undefined}
      />
    );
  };
  const renderSection = (header: ChatListItem, content: ReactNode[]) => (
    // A labelled group, not a region: several lists can show the same day.
    <div
      role="group"
      className="chat-message-list__day-section"
      aria-labelledby={header.kind === "day" ? dayHeaderId(header.day.key) : undefined}
    >
      {content}
    </div>
  );
  const pinnedKeys = useMemo(
    () => (editingMessageId ? [editingMessageId] : []),
    [editingMessageId],
  );
  const followEnd = useCallback(() => stickRef.current, []);

  const { attachList, rows, dataAttributes } = useWorkspaceListRows({
    items,
    getKey: chatListItemKey,
    renderItem,
    estimateSize: estimateChatListItem,
    isHeader: chatListItemIsHeader,
    renderSection,
    pinnedKeys,
    animateReorder: false,
    followEnd,
  });
  const attachRows = useCallback(
    (node: HTMLDivElement | null) => {
      rowsRef.current = node;
      attachList(node);
    },
    [attachList],
  );

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

    if (appended && previousId !== undefined) {
      const arrived = messagesAfter(messages, previousId).map(announcementFor);
      // Every arrival of this commit is read; the cap trims only what was read before.
      if (arrived.length > 0) {
        setAnnouncements((previous) => [...previous.slice(-ANNOUNCEMENTS_KEPT), ...arrived]);
      }
    }
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
    // Rows mounting, measuring or loading (link previews) change the rows' height.
    if (rowsRef.current) observer.observe(rowsRef.current);
    return () => observer.disconnect();
  }, [messages, currentUserId]);

  return (
    <div
      className={cn(
        "chat-ui chat-message-list",
        messages.length === 0 && "collection-state-host",
        className,
      )}
    >
      {/* New messages are read out here, once. The log is not live itself: the
          window mounts older rows as they scroll in, and those are not news. */}
      <div className="chat-message-list__announcer sr-only" aria-live="polite">
        {announcements.map((announcement) => (
          <p key={announcement.id}>{announcement.text}</p>
        ))}
      </div>
      {messages.length === 0 ? (
        <CollectionState icon={<MessageSquare className="size-12" />}>{emptyLabel}</CollectionState>
      ) : (
        <>
          <div
            ref={scrollerRef}
            className="chat-message-list__scroll"
            onScroll={onScroll}
            role="log"
            aria-live="off"
          >
            <div ref={attachRows} className="chat-message-list__rows" {...dataAttributes}>
              {rows}
            </div>
          </div>
          {showJump ? (
            <Button
              className="chat-message-list__jump"
              label={chatUiLabels.newMessages}
              size="md"
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
