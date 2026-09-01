import { useCallback, useMemo, useState } from "react";
import type { ChatMentionPrincipal, ChatSendPayload } from "@/chat-ui/src/chat-types";
import {
  meetChannelMessages,
  meetThreadParent,
  meetThreadReplies,
  upsertMeetChatMessage,
} from "@/meet-core/src/meet-chat-thread";
import type { ChatMessage, MeetChatOperations } from "@/meet-core/src/meet-types";

export type MeetActiveThread = {
  parent: ChatMessage;
  replies: ChatMessage[];
  directory: ChatMentionPrincipal[];
};

export type UseMeetChatSessionArgs = {
  initialMessages: ChatMessage[];
  operations?: MeetChatOperations;
  selectedChannelId: string | null;
  author: { id: string; displayName: string };
  directory: ChatMentionPrincipal[];
  initialThreadId?: string | null;
};

export function useMeetChatSession({
  initialMessages,
  operations,
  selectedChannelId,
  author,
  directory,
  initialThreadId = null,
}: UseMeetChatSessionArgs) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  const channelMessages = useMemo(
    () => meetChannelMessages(messages, selectedChannelId),
    [messages, selectedChannelId],
  );
  const parent = useMemo(() => meetThreadParent(messages, threadId), [messages, threadId]);
  const replies = useMemo(
    () => meetThreadReplies(messages, parent?.id ?? null),
    [messages, parent?.id],
  );
  const activeThread = useMemo<MeetActiveThread | null>(
    () => (parent ? { parent, replies, directory } : null),
    [directory, parent, replies],
  );

  const applyMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => upsertMeetChatMessage(current, message));
  }, []);

  const sendChannel = useCallback(
    async (payload: ChatSendPayload) => {
      if (!selectedChannelId) return;
      if (operations?.sendMessage) {
        applyMessage(await operations.sendMessage(selectedChannelId, payload.body));
        return;
      }
      applyMessage({
        id: `local-${Date.now()}`,
        channelId: selectedChannelId,
        authorId: author.id,
        authorName: author.displayName,
        body: payload.body,
        createdAt: Date.now(),
        reactions: [],
        mentions: payload.mentions,
        previews: [],
      });
    },
    [applyMessage, author, operations, selectedChannelId],
  );

  const sendThreadReply = useCallback(
    async (payload: ChatSendPayload) => {
      if (!parent) return;
      if (operations?.reply) {
        const next = await operations.reply(parent.id, payload.body);
        setMessages((current) => {
          const withReply = upsertMeetChatMessage(current, next);
          return withReply.map((row) =>
            row.id === parent.id ? { ...row, replyCount: (row.replyCount ?? 0) + 1 } : row,
          );
        });
        return;
      }
      applyMessage({
        id: `local-reply-${Date.now()}`,
        channelId: parent.channelId,
        authorId: author.id,
        authorName: author.displayName,
        body: payload.body,
        createdAt: Date.now(),
        reactions: [],
        mentions: payload.mentions,
        previews: [],
        parentId: parent.id,
        threadId: parent.threadId ?? parent.id,
      });
    },
    [applyMessage, author, operations, parent],
  );

  const editMessage = useCallback(
    async (messageId: string, payload: ChatSendPayload) => {
      if (operations?.editMessage) {
        applyMessage(await operations.editMessage(messageId, payload.body));
      } else {
        setMessages((current) =>
          current.map((row) =>
            row.id === messageId
              ? { ...row, body: payload.body, editedAt: Date.now(), mentions: payload.mentions }
              : row,
          ),
        );
      }
      setEditingMessageId(null);
    },
    [applyMessage, operations],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      await operations?.deleteMessage?.(messageId);
      setMessages((current) =>
        current.map((row) =>
          row.id === messageId
            ? { ...row, deletedAt: Date.now(), body: "", previews: [], mentions: [] }
            : row,
        ),
      );
    },
    [operations],
  );

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (operations?.react) {
        applyMessage(await operations.react(messageId, emoji));
        return;
      }
      setMessages((current) =>
        current.map((row) => {
          if (row.id !== messageId) return row;
          const existing = row.reactions.find((reaction) => reaction.emoji === emoji);
          const authors = existing?.authors ?? [];
          const nextAuthors = authors.includes(author.id)
            ? authors.filter((id) => id !== author.id)
            : [...authors, author.id];
          return {
            ...row,
            reactions: [
              ...row.reactions.filter((reaction) => reaction.emoji !== emoji),
              ...(nextAuthors.length > 0 ? [{ emoji, authors: nextAuthors }] : []),
            ],
          };
        }),
      );
    },
    [applyMessage, author.id, operations],
  );

  const openThread = useCallback((message: ChatMessage) => {
    setThreadId(message.parentId ?? message.threadId ?? message.id);
  }, []);

  const closeThread = useCallback(() => {
    setThreadId(null);
  }, []);

  return {
    messages,
    channelMessages,
    threadOpen: Boolean(activeThread),
    activeThread,
    editingMessageId,
    setEditingMessageId,
    sendChannel,
    sendThreadReply,
    editMessage,
    deleteMessage,
    react,
    openThread,
    closeThread,
  };
}
