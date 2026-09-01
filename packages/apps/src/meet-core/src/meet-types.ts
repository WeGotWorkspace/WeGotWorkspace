import type { ChatAuthorPresenceMap } from "@/chat-ui/src/chat-types";
import type { HttpSignalingFetch } from "@/lib/rtc/signaling/http-client";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { CollectionSharePrincipal, CollectionShareWith } from "@/share-ui/collection-share";
import type {
  WgwMeetChatRequest,
  WgwMeetChatResponse,
  WgwMeetJoinRequest,
  WgwMeetJoinResponse,
  WgwMeetLeaveRequest,
  WgwMeetLeaveResponse,
  WgwMeetPollRequest,
  WgwMeetPollResponse,
  WgwMeetPatchRoomRequest,
  WgwMeetReserveRoomRequest,
  WgwMeetRoomStatusRequest,
  WgwMeetRoomStatusResponse,
  WgwMeetSendRequest,
  WgwMeetSendResponse,
} from "@/lib/api/wgw/types";
import type { RtcSettings } from "@/lib/rtc/types";

export type MeetRtcSettings = RtcSettings;

export type MeetChannelKind = "channel" | "meeting";

export type MeetChannelRights = {
  mayWriteAll?: boolean;
  mayShare?: boolean;
  mayReadItems?: boolean;
  mayDelete?: boolean;
};

export type MeetChannel = {
  id: string;
  name: string;
  color?: string | null;
  kind: MeetChannelKind;
  scope: "personal" | "group";
  groupSlug?: string | null;
  shareWith?: CollectionShareWith | null;
  isSharee?: boolean;
  myRights?: MeetChannelRights | null;
  /** Meeting kind: guest access is on by default. */
  guestAccess?: boolean;
  guestRoomCode?: string | null;
  /** Optional channel topic shown in the main header subtitle. */
  topic?: string | null;
  /** Story/fixture unread count — not a live product signal. */
  unreadCount?: number;
  /** Optional roster size for header chrome; falls back to shareWith + owner. */
  memberCount?: number;
};

export type ChatReaction = {
  emoji: string;
  authors: string[];
};

export type ChatMention = {
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
  channelId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
  editedAt?: number | null;
  deletedAt?: number | null;
  reactions: ChatReaction[];
  mentions: ChatMention[];
  previews: ChatLinkPreview[];
  threadId?: string | null;
  replyCount?: number;
  parentId?: string | null;
};

export type MeetDirectoryGroup = {
  slug: string;
  displayName: string;
};

export type MeetUnfurlMap = Record<string, ChatLinkPreview>;

export type MeetChatState = {
  channels: MeetChannel[];
  messages: ChatMessage[];
};

export type MeetChannelWriteInput = {
  name: string;
  kind: MeetChannelKind;
  color?: string | null;
  groupSlug?: string | null;
};

export type MeetChannelPatchInput = {
  name?: string;
  color?: string | null;
  groupSlug?: string | null;
  shareWith?: CollectionShareWith | null;
};

export type MeetChatOperations = {
  sendMessage?: (
    channelId: string,
    body: string,
    opts?: { parentId?: string | null },
  ) => Promise<ChatMessage>;
  editMessage?: (messageId: string, body: string) => Promise<ChatMessage>;
  deleteMessage?: (messageId: string) => Promise<void>;
  react?: (messageId: string, emoji: string) => Promise<ChatMessage>;
  reply?: (parentId: string, body: string) => Promise<ChatMessage>;
  createChannel?: (input: MeetChannelWriteInput) => Promise<MeetChannel>;
  patchChannel?: (channelId: string, patch: MeetChannelPatchInput) => Promise<MeetChannel>;
  patchChannelShareWith?: (
    channelId: string,
    shareWith: CollectionShareWith,
  ) => Promise<MeetChannel>;
  startCall?: (channelId: string) => Promise<void>;
  leaveCall?: (channelId: string) => Promise<void>;
  searchSharePrincipals?: (query: string) => Promise<CollectionSharePrincipal[]>;
};

export type MeetUIData = {
  defaultDisplayName: string;
  rtc: MeetRtcSettings;
  channels?: MeetChannel[];
  messages?: ChatMessage[];
  directory?: CollectionSharePrincipal[];
  groups?: MeetDirectoryGroup[];
  unfurl?: MeetUnfurlMap;
  /** Fixture/demo presence for chat authors. */
  authorPresence?: ChatAuthorPresenceMap;
  /** Story/fixture unread counts keyed by directory user id — not a live product signal. */
  dmUnread?: Record<string, number>;
};

export type MeetAppBootstrap = {
  session: WorkspaceSession;
  data: MeetUIData;
};

export type MeetRequestOptions = {
  signal?: AbortSignal;
};

export type MeetAPIOperations = {
  roomStatus: (
    input: WgwMeetRoomStatusRequest,
    opts?: MeetRequestOptions,
  ) => Promise<WgwMeetRoomStatusResponse>;
  reserveRoom?: (
    input: WgwMeetReserveRoomRequest,
    opts?: MeetRequestOptions,
  ) => Promise<WgwMeetRoomStatusResponse>;
  patchRoomExpiresAt?: (
    input: WgwMeetPatchRoomRequest,
    opts?: MeetRequestOptions,
  ) => Promise<WgwMeetRoomStatusResponse>;
  join: (input: WgwMeetJoinRequest, opts?: MeetRequestOptions) => Promise<WgwMeetJoinResponse>;
  poll: (input: WgwMeetPollRequest, opts?: MeetRequestOptions) => Promise<WgwMeetPollResponse>;
  send: (input: WgwMeetSendRequest, opts?: MeetRequestOptions) => Promise<WgwMeetSendResponse>;
  leave: (input: WgwMeetLeaveRequest, opts?: MeetRequestOptions) => Promise<WgwMeetLeaveResponse>;
  chat: (input: WgwMeetChatRequest, opts?: MeetRequestOptions) => Promise<WgwMeetChatResponse>;
  /** Guest RTC signaling when the session has no auth token (wired in meet-api-source). */
  guestSignalingFetch?: () => HttpSignalingFetch;
};
