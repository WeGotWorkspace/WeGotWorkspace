import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { ChatMessage, MeetRtcSettings } from "@/meet-core/src/meet-types";
import { isWireDmChannel, meetChannelFromWire, type WgwChatChannel } from "@/lib/api/wgw/meet-chat";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  enqueueOutboxMutation,
  listOutboxMutationsForDomain,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  buildUiChannelIdMap,
  dmUnreadFromWireChannels,
  uiChatMessageFromMap,
  uiDmChannelIdForWire,
} from "@/lib/offline/meet-chat/meet-chat-dm";
import {
  MEET_CHAT_DOMAIN,
  meetChatChannelsTable,
  meetChatMessagesTable,
} from "@/lib/offline/meet-chat/meet-chat-schema";
import { rememberOfflineMeetChatUsername } from "@/lib/offline/offline-session";

export {
  enqueueOutboxMutation,
  listOutboxMutations,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";

const META_SESSION = "meet-chat:session";
const META_RTC = "meet-chat:rtc";

/** Sync-token scope for the channel collection list (`ChatChannel/changes`). */
export const MEET_CHAT_CHANNELS_TOKEN_SCOPE = "__channels__";

function metaKeyForSyncToken(scope: string): string {
  return `meet-chat:state:${scope}`;
}

function metaKeyForBackfill(channelId: string): string {
  return `meet-chat:backfill:${channelId}`;
}

// --- outbox payloads -----------------------------------------------------------------------------

export type MeetChatSendOutboxPayload = {
  messageId: string;
  channelId: string;
  body: string;
  parentId: string | null;
};

export type MeetChatEditOutboxPayload = {
  messageId: string;
  body: string;
};

export type MeetChatDeleteOutboxPayload = {
  messageId: string;
};

export type MeetChatReactOutboxPayload = {
  messageId: string;
  emoji: string;
};

export type MeetChatReadMarkerOutboxPayload = {
  channelId: string;
  lastReadTs: string;
  lastReadUid: string;
};

/** Message id targeted by a meet-chat outbox row, or null for non-message ops. */
export function meetChatOutboxMessageId(row: OfflineOutboxRow): string | null {
  if (row.domain !== MEET_CHAT_DOMAIN) return null;
  try {
    const payload = JSON.parse(row.payload) as { messageId?: string };
    return payload.messageId ?? null;
  } catch {
    return null;
  }
}

export async function listMeetChatOutbox(username: string): Promise<OfflineOutboxRow[]> {
  return listOutboxMutationsForDomain(username, MEET_CHAT_DOMAIN);
}

/**
 * Queue a message send. Sends never coalesce with other ops — the ULID is the
 * idempotency key, so a duplicated flush is safe by contract.
 */
export async function enqueueChatSend(
  username: string,
  payload: MeetChatSendOutboxPayload,
): Promise<void> {
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: MEET_CHAT_DOMAIN,
    op: "send",
    payload: JSON.stringify(payload),
  });
}

/**
 * Queue a body edit. When a `send` for the same ULID is still queued, the edit
 * merges into that send (the server has never seen the message — replaying
 * edit-before-create would 404). Otherwise later edits replace earlier queued
 * edits for the same message (LWW, matching the server's SEQUENCE rule).
 */
export async function enqueueChatEdit(
  username: string,
  payload: MeetChatEditOutboxPayload,
): Promise<void> {
  const rows = await listMeetChatOutbox(username);
  for (const row of rows) {
    if (meetChatOutboxMessageId(row) !== payload.messageId) continue;
    if (row.op === "send") {
      const send = JSON.parse(row.payload) as MeetChatSendOutboxPayload;
      const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
      await db.outbox.put({ ...row, payload: JSON.stringify({ ...send, body: payload.body }) });
      return;
    }
    if (row.op === "edit") {
      await removeOutboxMutation(username, row.id);
    }
  }
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: MEET_CHAT_DOMAIN,
    op: "edit",
    payload: JSON.stringify(payload),
  });
}

/**
 * Queue a delete tombstone. Drops every queued op for the message first; when a
 * queued `send` existed the server never saw the ULID, so no delete is queued at
 * all. Returns whether a server-side delete is still needed.
 */
export async function enqueueChatDelete(
  username: string,
  payload: MeetChatDeleteOutboxPayload,
): Promise<{ serverDeleteQueued: boolean }> {
  const rows = await listMeetChatOutbox(username);
  let hadQueuedSend = false;
  for (const row of rows) {
    if (meetChatOutboxMessageId(row) !== payload.messageId) continue;
    if (row.op === "send") hadQueuedSend = true;
    await removeOutboxMutation(username, row.id);
  }
  if (hadQueuedSend) return { serverDeleteQueued: false };
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: MEET_CHAT_DOMAIN,
    op: "delete",
    payload: JSON.stringify(payload),
  });
  return { serverDeleteQueued: true };
}

/**
 * Queue a reaction toggle. A queued toggle for the same `(messageId, emoji)`
 * cancels out (toggle twice = no-op) instead of replaying both — the server's
 * `(emoji, author)` set semantics make the pair a net zero.
 */
export async function enqueueChatReactionToggle(
  username: string,
  payload: MeetChatReactOutboxPayload,
): Promise<void> {
  const rows = await listMeetChatOutbox(username);
  for (const row of rows) {
    if (row.op !== "react" || meetChatOutboxMessageId(row) !== payload.messageId) continue;
    const queued = JSON.parse(row.payload) as MeetChatReactOutboxPayload;
    if (queued.emoji === payload.emoji) {
      await removeOutboxMutation(username, row.id);
      return;
    }
  }
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: MEET_CHAT_DOMAIN,
    op: "react",
    payload: JSON.stringify(payload),
  });
}

/** Queue a read marker; only the latest marker per channel survives. */
export async function enqueueChatReadMarker(
  username: string,
  payload: MeetChatReadMarkerOutboxPayload,
): Promise<void> {
  const rows = await listMeetChatOutbox(username);
  for (const row of rows) {
    if (row.op !== "readMarker") continue;
    const queued = JSON.parse(row.payload) as MeetChatReadMarkerOutboxPayload;
    if (queued.channelId === payload.channelId) {
      await removeOutboxMutation(username, row.id);
    }
  }
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: MEET_CHAT_DOMAIN,
    op: "readMarker",
    payload: JSON.stringify(payload),
  });
}

// --- channels ------------------------------------------------------------------------------------

/**
 * Channels are cached in **wire shape** (`WgwChatChannel`) so `dm` collections
 * survive round-trips for the DM rail (chunk G); `meetChannelFromWire` maps and
 * filters on read for the Channels sidebar.
 */
export async function upsertChatChannelInCache(
  username: string,
  channel: WgwChatChannel,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await meetChatChannelsTable(db).put({ id: channel.id, data: JSON.stringify(channel) });
}

/** Drop a channel plus its cached messages, sync token and backfill marker. */
export async function removeChatChannelFromCache(
  username: string,
  channelId: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  // DM messages are cached under the virtual `dm:{peer}` id — resolve it from
  // the stored wire row before that row disappears.
  const stored = await meetChatChannelsTable(db).get(channelId);
  let uiChannelId: string | null = null;
  if (stored) {
    try {
      uiChannelId = uiDmChannelIdForWire(JSON.parse(stored.data) as WgwChatChannel);
    } catch {
      // Malformed row — fall through to the real-id delete only.
    }
  }
  await meetChatChannelsTable(db).delete(channelId);
  await meetChatMessagesTable(db).where("channelId").equals(channelId).delete();
  if (uiChannelId) {
    await meetChatMessagesTable(db).where("channelId").equals(uiChannelId).delete();
  }
  await db.meta.delete(metaKeyForSyncToken(channelId));
  await db.meta.delete(metaKeyForBackfill(channelId));
  await db.meta.delete(metaKeyForMessageCursor(channelId));
}

export async function listCachedChatChannels(username: string): Promise<WgwChatChannel[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await meetChatChannelsTable(db).toArray();
  const parsed: WgwChatChannel[] = [];
  for (const row of rows) {
    try {
      parsed.push(JSON.parse(row.data) as WgwChatChannel);
    } catch {
      // Skip malformed rows; the next inbound sync rewrites them.
    }
  }
  return parsed.sort((a, b) => a.name.localeCompare(b.name));
}

/** Cached wire dm row for a peer principal, if the DM was ever provisioned. */
export async function findCachedDmChannelByPeer(
  username: string,
  peerPrincipalId: string,
): Promise<WgwChatChannel | undefined> {
  const channels = await listCachedChatChannels(username);
  return channels.find((row) => row.kind === "dm" && row.dmPeer === peerPrincipalId);
}

/** Real→virtual channel-id map over the cached channel list (dm rows only). */
export async function readUiChannelIdMap(username: string): Promise<Map<string, string>> {
  return buildUiChannelIdMap(await listCachedChatChannels(username));
}

/**
 * Re-key a wire-derived message onto its UI channel id: dm messages cache under
 * the virtual `dm:{peer}` id the workspace selects, everything else unchanged.
 */
export async function uiChatMessageForCache(
  username: string,
  message: ChatMessage,
): Promise<ChatMessage> {
  return uiChatMessageFromMap(message, await readUiChannelIdMap(username));
}

// --- messages ------------------------------------------------------------------------------------

export async function upsertChatMessageInCache(
  username: string,
  message: ChatMessage,
  pendingSync = false,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await meetChatMessagesTable(db).put({
    id: message.id,
    channelId: message.channelId,
    data: JSON.stringify(message),
    pendingSync,
    createdAt: message.createdAt,
  });
}

export async function getCachedChatMessage(
  username: string,
  messageId: string,
): Promise<ChatMessage | undefined> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await meetChatMessagesTable(db).get(messageId);
  if (!row) return undefined;
  try {
    return JSON.parse(row.data) as ChatMessage;
  } catch {
    return undefined;
  }
}

export async function removeChatMessageFromCache(
  username: string,
  messageId: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await meetChatMessagesTable(db).delete(messageId);
}

function compareMessages(a: ChatMessage, b: ChatMessage): number {
  // Ordering: (createdAt, ULID) — mirrors the server's read-marker comparator.
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export async function listCachedChatMessages(username: string): Promise<ChatMessage[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await meetChatMessagesTable(db).toArray();
  const messages: ChatMessage[] = [];
  for (const row of rows) {
    try {
      messages.push(JSON.parse(row.data) as ChatMessage);
    } catch {
      // Skip malformed rows; the next inbound sync rewrites them.
    }
  }
  return messages.sort(compareMessages);
}

export async function listPendingChatMessageIds(username: string): Promise<string[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await meetChatMessagesTable(db)
    .filter((row) => row.pendingSync)
    .toArray();
  return rows.map((row) => row.id);
}

// --- sync tokens / backfill markers --------------------------------------------------------------

export async function readMeetChatSyncToken(
  username: string,
  scope: string,
): Promise<string | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await db.meta.get(metaKeyForSyncToken(scope));
  return row?.value ?? null;
}

export async function writeMeetChatSyncToken(
  username: string,
  scope: string,
  token: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.meta.put({ key: metaKeyForSyncToken(scope), value: token });
}

function metaKeyForMessageCursor(channelId: string): string {
  return `meet-chat:cursor:${channelId}`;
}

/**
 * Highest message ULID ingested for a channel — the `since` cursor for the
 * messages list endpoint (new messages only; edits ride the changes feed).
 */
export async function readChatChannelMessageCursor(
  username: string,
  channelId: string,
): Promise<string | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await db.meta.get(metaKeyForMessageCursor(channelId));
  return row?.value ?? null;
}

export async function writeChatChannelMessageCursor(
  username: string,
  channelId: string,
  ulid: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const existing = await db.meta.get(metaKeyForMessageCursor(channelId));
  if (existing?.value && existing.value >= ulid) return;
  await db.meta.put({ key: metaKeyForMessageCursor(channelId), value: ulid });
}

export async function isChatChannelBackfilled(
  username: string,
  channelId: string,
): Promise<boolean> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await db.meta.get(metaKeyForBackfill(channelId));
  return row?.value === "done";
}

export async function markChatChannelBackfilled(
  username: string,
  channelId: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.meta.put({ key: metaKeyForBackfill(channelId), value: "done" });
}

// --- bootstrap meta ------------------------------------------------------------------------------

export async function writeMeetChatBootstrapMetaToCache(
  username: string,
  session: WorkspaceSession,
  rtc: MeetRtcSettings,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.meta.put({ key: META_SESSION, value: JSON.stringify(session) });
  await db.meta.put({ key: META_RTC, value: JSON.stringify(rtc) });
  rememberOfflineMeetChatUsername(username);
}

export type MeetChatCachedBootstrap = {
  session: WorkspaceSession;
  rtc: MeetRtcSettings;
  channels: ReturnType<typeof meetChannelFromWire>[];
  messages: ChatMessage[];
  /** Live DM unread badge counts keyed by peer principal (chunk G). */
  dmUnread: Record<string, number>;
};

/** Cache snapshot for offline mount; null until a live bootstrap has been cached. */
export async function readMeetChatBootstrapFromCache(
  username: string,
): Promise<MeetChatCachedBootstrap | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const sessionRow = await db.meta.get(META_SESSION);
  const rtcRow = await db.meta.get(META_RTC);
  if (!sessionRow?.value || !rtcRow?.value) return null;
  const wireChannels = await listCachedChatChannels(username);
  return {
    session: JSON.parse(sessionRow.value) as WorkspaceSession,
    rtc: JSON.parse(rtcRow.value) as MeetRtcSettings,
    channels: wireChannels.filter((row) => !isWireDmChannel(row)).map(meetChannelFromWire),
    messages: await listCachedChatMessages(username),
    dmUnread: dmUnreadFromWireChannels(wireChannels),
  };
}
