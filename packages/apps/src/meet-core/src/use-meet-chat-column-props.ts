import { useCallback, useMemo } from "react";
import type {
  ChatAuthorPresenceMap,
  ChatMentionPrincipal,
  ChatSendPayload,
} from "@/chat-ui/src/chat-types";
import type { MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import {
  meetCallStageShowsStage,
  type MeetCallStageLayout,
} from "@/meet-core/src/meet-call-stage-layout";
import { mergeMeetRoomChatIntoChannel } from "@/meet-core/src/meet-chat-line";
import type { MeetChatColumnProps } from "@/meet-core/src/meet-chat-column";
import type { ChatMessage } from "@/meet-core/src/meet-types";
import type { useMeetChatSession } from "@/meet-core/src/use-meet-chat-session";

export type MeetChatColumnWiring = {
  /** Everything the chat column needs except the caught-up callback, which differs per surface. */
  chatColumnProps: Omit<MeetChatColumnProps, "onCaughtUpChange">;
  sendThreadReply: (parentId: string, body: string) => void;
  onToggleThreadReaction: (messageId: string, emoji: string) => void;
  onSaveEdit: (messageId: string, payload: ChatSendPayload) => void;
  onCancelEdit: () => void;
};

/** Messages and actions for the Meet chat column and its thread, bound to the chat session. */
export function useMeetChatColumnProps({
  chat,
  selectedId,
  currentUserId,
  mentionPrincipals,
  authorPresence,
  placeholder,
  typingByChannel,
  onComposerTyping,
  callRoom,
  liveCallChannelId,
  stageLayout,
  onOpenThread,
  onExpandChatPanel,
  onSendThreadReply,
  onError,
}: {
  chat: ReturnType<typeof useMeetChatSession>;
  selectedId: string | null;
  currentUserId: string;
  mentionPrincipals: ChatMentionPrincipal[];
  authorPresence?: ChatAuthorPresenceMap;
  placeholder?: string;
  typingByChannel?: Record<string, string[]>;
  onComposerTyping?: (channelId: string, typing: boolean) => void;
  callRoom?: MeetCallStageRoomProps | null;
  liveCallChannelId?: string | null;
  stageLayout: MeetCallStageLayout;
  onOpenThread: (message: ChatMessage) => void;
  /** Expanded call: replying has to bring the chat rail back out. */
  onExpandChatPanel: () => void;
  onSendThreadReply?: (parentId: string, body: string) => void;
  onError: (error: unknown) => void;
}): MeetChatColumnWiring {
  const sendThreadReply = useCallback(
    (parentId: string, body: string) => {
      if (onSendThreadReply) {
        onSendThreadReply(parentId, body);
        return;
      }
      void chat.sendThreadReply({ body, mentions: [] }).catch(onError);
    },
    [chat.sendThreadReply, onError, onSendThreadReply],
  );
  const onToggleThreadReaction = useCallback(
    (messageId: string, emoji: string) => {
      void chat.react(messageId, emoji).catch(onError);
    },
    [chat.react, onError],
  );
  const onSendChannel = useCallback(
    (payload: ChatSendPayload) => {
      // The send hands back its echo id before the save settles, so the room
      // copy goes out beside the channel write instead of behind it.
      const send = chat.sendChannel(payload);
      void send.saved.catch(onError);
      if (callRoom?.controller.inCall) {
        void callRoom.controller.sendChat(payload.body, send);
      }
    },
    [callRoom, chat.sendChannel, onError],
  );
  const onReactChannel = useCallback(
    (messageId: string, emoji: string) => {
      void chat.react(messageId, emoji).catch(onError);
    },
    [chat.react, onError],
  );
  const onReplyChannel = useCallback(
    (message: ChatMessage) => {
      if (meetCallStageShowsStage(stageLayout)) onExpandChatPanel();
      onOpenThread(message);
    },
    [onExpandChatPanel, onOpenThread, stageLayout],
  );
  const onDeleteChannel = useCallback(
    (messageId: string) => {
      void chat.deleteMessage(messageId).catch(onError);
    },
    [chat.deleteMessage, onError],
  );
  const onCancelEdit = useCallback(() => {
    chat.setEditingMessageId(null);
  }, [chat.setEditingMessageId]);
  const onSaveEdit = useCallback(
    (messageId: string, payload: ChatSendPayload) => {
      void chat.editMessage(messageId, payload).catch(onError);
    },
    [chat.editMessage, onError],
  );
  const typingNames = useMemo(() => {
    if (!selectedId) return [];
    return (typingByChannel?.[selectedId] ?? [])
      .filter((userId) => userId !== currentUserId)
      .map(
        (userId) =>
          mentionPrincipals.find((principal) => principal.id === userId)?.displayName ?? userId,
      );
  }, [currentUserId, mentionPrincipals, selectedId, typingByChannel]);
  const onComposerTypingForSelected = useCallback(
    (typing: boolean) => {
      if (selectedId) onComposerTyping?.(selectedId, typing);
    },
    [onComposerTyping, selectedId],
  );
  const liveCallMessages = useMemo(
    () =>
      mergeMeetRoomChatIntoChannel(
        chat.channelMessages,
        callRoom?.controller.inCall ? callRoom.controller.chatMessages : [],
        selectedId ?? liveCallChannelId ?? "call",
      ),
    [
      callRoom?.controller.chatMessages,
      callRoom?.controller.inCall,
      chat.channelMessages,
      liveCallChannelId,
      selectedId,
    ],
  );
  return {
    chatColumnProps: {
      messages: liveCallMessages,
      currentUserId,
      principals: mentionPrincipals,
      authorPresence,
      placeholder,
      onSend: onSendChannel,
      onReact: onReactChannel,
      onReply: onReplyChannel,
      onDelete: onDeleteChannel,
      editingMessageId: chat.editingMessageId,
      onStartEdit: chat.setEditingMessageId,
      onCancelEdit,
      onSaveEdit,
      typingNames,
      onComposerTyping: onComposerTypingForSelected,
    },
    sendThreadReply,
    onToggleThreadReaction,
    onSaveEdit,
    onCancelEdit,
  };
}
