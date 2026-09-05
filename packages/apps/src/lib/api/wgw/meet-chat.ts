import type {
  ChatChannel as WgwChatChannel,
  ChatChannelChangesResponse,
  ChatChannelCreate,
  ChatChannelListResponse,
  ChatChannelPatch,
  ChatMessage as WgwChatMessage,
  ChatMessageChangesResponse,
  ChatMessageCreate,
  ChatMessageListResponse,
  ChatMessagePatch,
} from "@wgw-api-generated/chat-types";
import type {
  ChatMessage,
  MeetChannel,
  MeetChannelKind,
  MeetChannelRights,
} from "@/meet-core/src/meet-types";
import type { CollectionShareWith } from "@/share-ui/collection-share";
import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";

export type { WgwChatChannel, WgwChatMessage };

export class MeetChatRequestError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function meetChatHttpStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | undefined)?.status;
  return typeof status === "number" ? status : null;
}

/** 404: the server-side object (message/channel) is gone — safe to drop local state. */
export function isMeetChatGone(error: unknown): boolean {
  return meetChatHttpStatus(error) === 404;
}

/** Server pruned the change log — callers must fall back to a full resync. */
export function isMeetChatCannotCalculateChanges(error: unknown): boolean {
  return error instanceof MeetChatRequestError && error.code === "cannotCalculateChanges";
}

type MeetChatRequestOpts = {
  signal?: AbortSignal;
};

async function requestChatJson(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  opts?: MeetChatRequestOpts,
): Promise<unknown> {
  const headers = new Headers();
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const init: RequestInit = { method, signal: opts?.signal, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await wgwFetch(path, init);
  if (!res.ok) {
    let code: string | undefined;
    try {
      const errorBody = (await res.json()) as { code?: string };
      if (typeof errorBody.code === "string") code = errorBody.code;
    } catch {
      // Status alone is enough when the body is not JSON.
    }
    throw new MeetChatRequestError(`${method} ${path} failed (${res.status})`, res.status, code);
  }
  if (res.status === 204) return undefined;
  return wgwReadJson(res);
}

// --- wire → app mapping --------------------------------------------------------------------------

function channelKindFromWire(kind: WgwChatChannel["kind"]): MeetChannelKind {
  // "dm" collections stay cached but are surfaced by the DM rail (chunk G), so the
  // MeetChannel type only models channel|meeting; callers filter dm rows out first.
  return kind === "meeting" ? "meeting" : "channel";
}

function rightsFromWire(rights: WgwChatChannel["myRights"]): MeetChannelRights {
  return {
    mayReadItems: rights.mayReadItems,
    mayWriteAll: rights.mayWriteAll,
    mayShare: rights.mayShare,
    mayDelete: rights.mayDelete,
  };
}

/** True for wire rows the Channels sidebar must not show (DM collections, chunk G). */
export function isWireDmChannel(row: WgwChatChannel): boolean {
  return row.kind === "dm";
}

export function meetChannelFromWire(row: WgwChatChannel): MeetChannel {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    kind: channelKindFromWire(row.kind),
    scope: row.scope,
    groupSlug: row.groupSlug,
    shareWith: (row.shareWith ?? null) as CollectionShareWith | null,
    isSharee: row.isSharee,
    myRights: rightsFromWire(row.myRights),
    ...(row.kind === "meeting" && row.guestRoomCode ? { guestAccess: true } : {}),
    guestRoomCode: row.guestRoomCode ?? null,
    topic: row.topic ?? null,
    ...(row.unreadCount !== undefined ? { unreadCount: row.unreadCount } : {}),
    ...(row.memberCount !== undefined ? { memberCount: row.memberCount } : {}),
  };
}

function epochMsFromUtc(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Wire → app message. `previews` stay client-side (internal links resolve locally);
 * `threadId` equals the thread-root `parentId` — the server model is single-level
 * (`RELATED-TO` always points at the thread root).
 */
export function chatMessageFromWire(row: WgwChatMessage): ChatMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    createdAt: epochMsFromUtc(row.createdAt),
    editedAt: row.editedAt ? epochMsFromUtc(row.editedAt) : null,
    deletedAt: row.deletedAt ? epochMsFromUtc(row.deletedAt) : null,
    reactions: row.reactions.map((reaction) => ({
      emoji: reaction.emoji,
      authors: [...reaction.authors],
    })),
    mentions: row.mentions.map((mention) => ({
      id: mention.id,
      displayName: mention.displayName,
    })),
    previews: [],
    parentId: row.parentId ?? null,
    threadId: row.parentId ?? null,
    ...(row.replyCount !== undefined ? { replyCount: row.replyCount } : {}),
  };
}

// --- channels ------------------------------------------------------------------------------------

export async function listChatChannels(opts?: MeetChatRequestOpts): Promise<WgwChatChannel[]> {
  const json = (await requestChatJson(
    "/chat/channels",
    "GET",
    undefined,
    opts,
  )) as ChatChannelListResponse;
  return Array.isArray(json?.list) ? json.list : [];
}

export async function getChatChannel(
  channelId: string,
  opts?: MeetChatRequestOpts,
): Promise<WgwChatChannel> {
  return (await requestChatJson(
    `/chat/channels/${encodeURIComponent(channelId)}`,
    "GET",
    undefined,
    opts,
  )) as WgwChatChannel;
}

export async function createChatChannel(
  body: ChatChannelCreate,
  opts?: MeetChatRequestOpts,
): Promise<WgwChatChannel> {
  return (await requestChatJson("/chat/channels", "POST", body, opts)) as WgwChatChannel;
}

export async function patchChatChannel(
  channelId: string,
  patch: ChatChannelPatch,
  opts?: MeetChatRequestOpts,
): Promise<WgwChatChannel> {
  return (await requestChatJson(
    `/chat/channels/${encodeURIComponent(channelId)}`,
    "PATCH",
    patch,
    opts,
  )) as WgwChatChannel;
}

export async function deleteChatChannel(
  channelId: string,
  opts?: MeetChatRequestOpts,
): Promise<void> {
  await requestChatJson(
    `/chat/channels/${encodeURIComponent(channelId)}`,
    "DELETE",
    undefined,
    opts,
  );
}

export async function listChatChannelChanges(
  since: string | null,
  opts?: MeetChatRequestOpts,
): Promise<ChatChannelChangesResponse> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  return (await requestChatJson(
    `/chat/channels/changes${query}`,
    "GET",
    undefined,
    opts,
  )) as ChatChannelChangesResponse;
}

// --- messages ------------------------------------------------------------------------------------

export type ListChatMessagesOptions = MeetChatRequestOpts & {
  /** Return messages after this ULID cursor (exclusive), ascending. */
  since?: string;
  /** Return messages before this ULID cursor (exclusive) — history backfill. */
  before?: string;
  limit?: number;
};

export async function listChatMessages(
  channelId: string,
  opts?: ListChatMessagesOptions,
): Promise<ChatMessageListResponse> {
  const params = new URLSearchParams();
  if (opts?.since) params.set("since", opts.since);
  if (opts?.before) params.set("before", opts.before);
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const json = (await requestChatJson(
    `/chat/channels/${encodeURIComponent(channelId)}/messages${query}`,
    "GET",
    undefined,
    opts,
  )) as ChatMessageListResponse;
  return {
    list: Array.isArray(json?.list) ? json.list : [],
    hasMore: json?.hasMore === true,
  };
}

export async function sendChatMessage(
  channelId: string,
  body: ChatMessageCreate,
  opts?: MeetChatRequestOpts,
): Promise<WgwChatMessage> {
  return (await requestChatJson(
    `/chat/channels/${encodeURIComponent(channelId)}/messages`,
    "POST",
    body,
    opts,
  )) as WgwChatMessage;
}

export async function patchChatMessage(
  messageId: string,
  patch: ChatMessagePatch,
  opts?: MeetChatRequestOpts,
): Promise<WgwChatMessage> {
  return (await requestChatJson(
    `/chat/messages/${encodeURIComponent(messageId)}`,
    "PATCH",
    patch,
    opts,
  )) as WgwChatMessage;
}

export async function deleteChatMessage(
  messageId: string,
  opts?: MeetChatRequestOpts,
): Promise<void> {
  await requestChatJson(
    `/chat/messages/${encodeURIComponent(messageId)}`,
    "DELETE",
    undefined,
    opts,
  );
}

export async function toggleChatReaction(
  messageId: string,
  emoji: string,
  opts?: MeetChatRequestOpts,
): Promise<WgwChatMessage> {
  return (await requestChatJson(
    `/chat/messages/${encodeURIComponent(messageId)}/reactions`,
    "POST",
    { emoji },
    opts,
  )) as WgwChatMessage;
}

export async function putChatReadMarker(
  channelId: string,
  body: { lastReadTs: string; lastReadUid: string },
  opts?: MeetChatRequestOpts,
): Promise<void> {
  await requestChatJson(
    `/chat/channels/${encodeURIComponent(channelId)}/read-marker`,
    "PUT",
    body,
    opts,
  );
}

export async function listChatMessageChanges(
  channelId: string,
  since: string | null,
  opts?: MeetChatRequestOpts,
): Promise<ChatMessageChangesResponse> {
  const params = new URLSearchParams({ channelId });
  if (since) params.set("since", since);
  return (await requestChatJson(
    `/chat/messages/changes?${params.toString()}`,
    "GET",
    undefined,
    opts,
  )) as ChatMessageChangesResponse;
}
