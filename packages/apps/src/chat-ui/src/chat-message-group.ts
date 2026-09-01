import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import type { ChatMessage } from "@/chat-ui/src/chat-types";

export const CHAT_MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

export type ChatMessageGroup = {
  id: string;
  authorId: string;
  authorName: string;
  messages: ChatMessage[];
};

export function groupChatMessages(
  messages: readonly ChatMessage[],
  windowMs = CHAT_MESSAGE_GROUP_WINDOW_MS,
): ChatMessageGroup[] {
  const groups: ChatMessageGroup[] = [];

  for (const message of messages) {
    const previous = groups[groups.length - 1];
    const last = previous?.messages[previous.messages.length - 1];
    const sameAuthor = previous?.authorId === message.authorId;
    const withinWindow = last != null && message.createdAt - last.createdAt <= windowMs;
    if (previous && sameAuthor && withinWindow) {
      previous.messages.push(message);
      continue;
    }
    groups.push({
      id: message.id,
      authorId: message.authorId,
      authorName: message.authorName,
      messages: [message],
    });
  }

  return groups;
}

export function formatChatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local calendar day key (`YYYY-MM-DD`) for grouping date separators. */
export function chatMessageDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatChatDayLabel(timestamp: number, now = Date.now()): string {
  const day = startOfLocalDay(timestamp);
  const today = startOfLocalDay(now);
  if (day === today) return chatUiLabels.today;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return chatUiLabels.yesterday;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
