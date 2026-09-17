import type { ChatMessage } from "@/meet-core/src/meet-types";
import {
  meetDirectMessageChannelId,
  meetDirectMessagePrincipalId,
} from "@/meet-core/src/meet-direct-messages";
import type { PresenceChannelMessage } from "@/presence-core/src/presence-types";

export type MeetMeshChatMessage = PresenceChannelMessage;

export function meetMeshChatMessageFromApp(message: ChatMessage): MeetMeshChatMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    authorName: message.authorName,
    body: message.body,
    createdAt: message.createdAt,
    parentId: message.parentId ?? null,
  };
}

export function meetMeshChatMessageToApp(message: MeetMeshChatMessage): ChatMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    authorName: message.authorName,
    body: message.body,
    createdAt: message.createdAt,
    reactions: [],
    mentions: [],
    previews: [],
    parentId: message.parentId ?? null,
    threadId: message.parentId ?? null,
    replyCount: 0,
  };
}

/**
 * Sender addresses a DM as `dm:{peer}` (their rail id). The receiver's rail id
 * for that conversation is `dm:{sender}`.
 */
export function meetMeshReceiveChannelId(channelId: string, senderUsername: string): string {
  if (!meetDirectMessagePrincipalId(channelId) || !senderUsername) return channelId;
  return meetDirectMessageChannelId(senderUsername);
}
