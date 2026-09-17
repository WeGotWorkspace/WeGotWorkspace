import type { JmapId } from "../core/types.js";

/**
 * Wire shapes for `urn:wgw:jmap:chat` (`ChatChannel/*`, `ChatMessage/*`).
 *
 * CONTRACT ASSUMPTION (chunk D not yet built): JMAP objects use the **same field
 * names and value shapes as the REST OpenAPI schemas** `ChatChannel` /
 * `ChatMessage` (`openapi/schemas/chat/`), exactly like Notes where `JmapNote`
 * mirrors the REST VJOURNAL note shape. Every assumption is listed in
 * `packages/apps/docs/meet-chat-client.md`.
 */

export type JmapChatChannelRights = {
  mayReadItems: boolean;
  mayWriteAll: boolean;
  mayShare: boolean;
  mayDelete: boolean;
  [key: string]: unknown;
};

export type JmapChatChannel = {
  id: JmapId;
  name: string;
  color?: string | null;
  kind: "channel" | "meeting" | "dm";
  scope: "personal" | "group";
  groupSlug: string | null;
  shareWith?: Record<string, Record<string, boolean>> | null;
  isSharee: boolean;
  myRights: JmapChatChannelRights;
  topic?: string | null;
  guestRoomCode?: string | null;
  memberCount?: number;
  unreadCount?: number;
};

export type JmapChatReaction = {
  emoji: string;
  authors: string[];
};

export type JmapChatMention = {
  id: string;
  displayName: string;
};

export type JmapChatMessage = {
  /** Client-generated ULID (VJOURNAL UID). */
  id: JmapId;
  channelId: string;
  authorId: string;
  authorName: string;
  body: string;
  /** UTCDate string — server-assigned creation timestamp. */
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  parentId?: string | null;
  replyCount?: number;
  reactions: JmapChatReaction[];
  mentions: JmapChatMention[];
};
