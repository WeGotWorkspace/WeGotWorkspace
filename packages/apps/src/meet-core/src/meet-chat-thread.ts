import type { ChatMessage } from "@/meet-core/src/meet-types";

export function meetChannelMessages(
  messages: readonly ChatMessage[],
  channelId: string | null,
): ChatMessage[] {
  if (!channelId) return [];
  return messages.filter((row) => row.channelId === channelId && !row.parentId);
}

export function meetThreadParent(
  messages: readonly ChatMessage[],
  messageId: string | null,
): ChatMessage | null {
  if (!messageId) return null;
  const seed = messages.find((row) => row.id === messageId);
  if (!seed) return null;
  const parentId = seed.parentId ?? seed.threadId ?? seed.id;
  return messages.find((row) => row.id === parentId) ?? seed;
}

export function meetThreadReplies(
  messages: readonly ChatMessage[],
  parentId: string | null,
): ChatMessage[] {
  if (!parentId) return [];
  return messages.filter(
    (row) => row.id !== parentId && (row.threadId === parentId || row.parentId === parentId),
  );
}

export function upsertMeetChatMessage(
  messages: readonly ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const exists = messages.some((row) => row.id === message.id);
  return exists
    ? messages.map((row) => (row.id === message.id ? message : row))
    : [...messages, message];
}
