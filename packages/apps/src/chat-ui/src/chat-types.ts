import type { UserAvatarPresence } from "@/user-avatar/src/user-avatar";

export type ChatAuthorPresence = UserAvatarPresence;

export type ChatAuthorPresenceMap = Readonly<Partial<Record<string, ChatAuthorPresence>>>;

export type ChatReaction = {
  emoji: string;
  authors: string[];
};

export type ChatMention = {
  id: string;
  displayName: string;
};

export type ChatMentionPrincipal = {
  id: string;
  displayName: string;
};

export type ChatLinkPreviewKind = "internal-file" | "internal-docs" | "external";

export type ChatLinkPreview = {
  url: string;
  kind: ChatLinkPreviewKind;
  title?: string;
  description?: string;
  siteName?: string;
  fileId?: string;
  docsId?: string;
  /** Optional fixture body for compact Docs previews (no network). */
  content?: string;
};

export type ChatMessage = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
  editedAt?: number | null;
  deletedAt?: number | null;
  reactions: ChatReaction[];
  mentions: ChatMention[];
  previews: ChatLinkPreview[];
  channelId?: string;
  threadId?: string | null;
  replyCount?: number;
  parentId?: string | null;
};

export type ChatUnfurlMap = Record<string, ChatLinkPreview>;

export type ChatSendPayload = {
  body: string;
  mentions: ChatMention[];
};
