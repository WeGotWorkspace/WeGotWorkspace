import {
  chatMessageDayKey,
  groupChatMessages,
  groupChatMessagesByDay,
  type ChatDaySection,
} from "@/chat-ui/src/chat-message-group";
import type { ChatMessage } from "@/lib/models/chat-types";

/** A day's sticky header, at the top of its section. */
export type ChatListDayItem = { kind: "day"; key: string; day: ChatDaySection };

/** One message. Spacing comes from these flags, not from its DOM neighbours (which may be spacers). */
export type ChatListMessageItem = {
  kind: "message";
  key: string;
  message: ChatMessage;
  /** A follow-up in the same author run: no avatar or name. */
  continuation: boolean;
  /** The next message continues this run: tight bottom padding. */
  beforeContinuation: boolean;
  /** Opens a new author run after an earlier run on the same day: the gap between runs. */
  groupStart: boolean;
};

export type ChatListItem = ChatListDayItem | ChatListMessageItem;

/** Estimated row pitch before a row is measured (px, the run gap included). */
const DAY_HEADER_PX = 36;
const MESSAGE_PX = 112;
const CONTINUATION_PX = 48;
const GROUP_GAP_PX = 8;

/**
 * The chat log as one flat list in display order: per day its header, then its
 * messages. The window mounts any slice of it.
 */
export function chatListItems(messages: readonly ChatMessage[], now = Date.now()): ChatListItem[] {
  const items: ChatListItem[] = [];
  for (const day of groupChatMessagesByDay(groupChatMessages(messages), now)) {
    items.push({ kind: "day", key: `day-${day.key}`, day });
    day.groups.forEach((group, groupIndex) => {
      group.messages.forEach((message, index) => {
        items.push({
          kind: "message",
          key: message.id,
          message,
          continuation: index > 0,
          beforeContinuation: index < group.messages.length - 1,
          groupStart: index === 0 && groupIndex > 0,
        });
      });
    });
  }
  return items;
}

/** The day labels change at midnight: the list rebuilds when this key does. */
export function chatListTodayKey(now = Date.now()): string {
  return chatMessageDayKey(now);
}

export function chatListItemKey(item: ChatListItem): string {
  return item.key;
}

export function chatListItemIsHeader(item: ChatListItem): boolean {
  return item.kind === "day";
}

export function estimateChatListItem(item: ChatListItem): number {
  if (item.kind === "day") return DAY_HEADER_PX;
  return (item.continuation ? CONTINUATION_PX : MESSAGE_PX) + (item.groupStart ? GROUP_GAP_PX : 0);
}
