import type {
  ChatMessage,
  MeetAppBootstrap,
  MeetChannel,
  MeetChannelPatchInput,
  MeetChannelWriteInput,
  MeetChatOperations,
} from "@/meet-core/src/meet-types";
import type { ChatChannelPatch } from "@wgw-api-generated/chat-types";
import type { CollectionShareWith } from "@/share-ui/collection-share";
import { searchCollectionSharePrincipals } from "@/lib/api/wgw/calendar";
import {
  chatMessageFromWire,
  createChatChannel,
  deleteChatMessage,
  isMeetChatGone,
  meetChannelFromWire,
  meetChatHttpStatus,
  openChatDm,
  patchChatChannel,
  patchChatMessage,
  sendChatMessage,
  toggleChatReaction,
} from "@/lib/api/wgw/meet-chat";
import { fetchMeetLiveBootstrap } from "@/lib/api/wgw/meet";
import { fetchMeetChatDirectory } from "@/lib/api/wgw/meet-chat-directory";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
import { createChatMessageUlid } from "@/lib/offline/meet-chat/chat-ulid";
import { resolveRestChannelId } from "@/lib/offline/meet-chat/meet-chat-dm-resolve";
import {
  enqueueChatDelete,
  enqueueChatEdit,
  enqueueChatReactionToggle,
  enqueueChatSend,
  findCachedDmChannelByPeer,
  getCachedChatMessage,
  readMeetChatBootstrapFromCache,
  removeChatMessageFromCache,
  uiChatMessageForCache,
  upsertChatChannelInCache,
  upsertChatMessageInCache,
  writeChatChannelMessageCursor,
  writeMeetChatBootstrapMetaToCache,
  type MeetChatCachedBootstrap,
} from "@/lib/offline/meet-chat-offline-store";
import {
  flushMeetChatOutbox,
  type MeetChatOutboxFlushResult,
} from "@/lib/offline/meet-chat-outbox-flush";
import { syncMeetChatInboundFromRest } from "@/lib/offline/meet-chat-inbound-sync";
import { readOfflineMeetChatUsername } from "@/lib/offline/offline-session";

export type MeetChatAuthor = {
  id: string;
  displayName: string;
};

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<MeetChatOutboxFlushResult>();

export function getMeetChatSyncRunner(
  username: string,
): ConnectivitySyncRunner<MeetChatOutboxFlushResult> {
  return syncRunnerRegistry.getOrCreate(username, () => flushMeetChatOutbox(username));
}

function rethrowUnlessOfflineQueue(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw error;
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (!isFetchNetworkError(error)) throw error;
}

/**
 * Queue instead of failing the write. Auth (401/403) and semantic rejections
 * (4xx) stay thrown; network errors and 5xx enqueue — message ops replay
 * idempotently (client ULIDs / tombstones / toggle pair-cancel).
 */
function shouldQueueChatWrite(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const status = meetChatHttpStatus(error);
  if (status === 401 || status === 403) return false;
  if (status != null && status >= 500) return true;
  if (status != null) return false;
  return isFetchNetworkError(error);
}

function buildOptimisticMessage(
  author: MeetChatAuthor,
  channelId: string,
  body: string,
  parentId: string | null,
  id: string,
): ChatMessage {
  return {
    id,
    channelId,
    authorId: author.id,
    authorName: author.displayName,
    body: body.trim(),
    createdAt: Date.now(),
    reactions: [],
    mentions: [],
    previews: [],
    parentId,
    threadId: parentId,
    replyCount: 0,
  };
}

async function bumpParentReplyCount(username: string, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const parent = await getCachedChatMessage(username, parentId);
  if (!parent) return;
  await upsertChatMessageInCache(username, {
    ...parent,
    replyCount: (parent.replyCount ?? 0) + 1,
  });
}

function toggleReactionLocally(message: ChatMessage, emoji: string, authorId: string): ChatMessage {
  const reactions = message.reactions.map((row) => ({ ...row, authors: [...row.authors] }));
  const existing = reactions.find((row) => row.emoji === emoji);
  if (!existing) {
    reactions.push({ emoji, authors: [authorId] });
  } else if (existing.authors.includes(authorId)) {
    existing.authors = existing.authors.filter((id) => id !== authorId);
  } else {
    existing.authors.push(authorId);
  }
  return { ...message, reactions: reactions.filter((row) => row.authors.length > 0) };
}

/** UI `CollectionShareWith` → wire `ChatChannelPatch["shareWith"]` (full rights rows). */
function wireShareWithFromCollection(
  shareWith: CollectionShareWith,
): NonNullable<ChatChannelPatch["shareWith"]> {
  const out: NonNullable<ChatChannelPatch["shareWith"]> = {};
  for (const [principal, rights] of Object.entries(shareWith)) {
    if (rights === null) {
      out[principal] = null;
      continue;
    }
    out[principal] = {
      mayRead: rights.mayRead !== false,
      mayWrite: Boolean(rights.mayWrite ?? rights.mayWriteAll),
      mayShare: rights.mayShare === true,
      mayDelete: rights.mayDelete === true,
    };
  }
  return out;
}

function wireChannelPatchFromInput(patch: MeetChannelPatchInput): ChatChannelPatch {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.groupSlug !== undefined ? { groupSlug: patch.groupSlug } : {}),
    ...(patch.shareWith !== undefined
      ? { shareWith: patch.shareWith ? wireShareWithFromCollection(patch.shareWith) : null }
      : {}),
  };
}

export function createHybridMeetChatOperations(
  username: string,
  author: MeetChatAuthor,
): MeetChatOperations {
  const runner = getMeetChatSyncRunner(username);

  const sendMessageHybrid = async (
    channelId: string,
    body: string,
    parentId: string | null,
  ): Promise<ChatMessage> => {
    const id = createChatMessageUlid();
    // The optimistic message keeps the UI channel id (virtual `dm:{peer}` for
    // DM sends) so the workspace applies it to the open conversation.
    const optimistic = buildOptimisticMessage(author, channelId, body, parentId, id);
    const queueSend = async (): Promise<ChatMessage> => {
      await upsertChatMessageInCache(username, optimistic, true);
      await bumpParentReplyCount(username, parentId);
      await enqueueChatSend(username, {
        messageId: id,
        channelId,
        body: optimistic.body,
        parentId,
      });
      return optimistic;
    };
    if (!readBrowserOnline()) return queueSend();
    try {
      // DM sends find-or-create the real dm- collection first (idempotent).
      const restChannelId = await resolveRestChannelId(username, channelId);
      const saved = await uiChatMessageForCache(
        username,
        chatMessageFromWire(
          await sendChatMessage(restChannelId, {
            id,
            body: optimistic.body,
            ...(parentId ? { parentId } : {}),
          }),
        ),
      );
      await upsertChatMessageInCache(username, saved, false);
      await writeChatChannelMessageCursor(username, restChannelId, saved.id);
      await bumpParentReplyCount(username, parentId);
      await runner.flush();
      return saved;
    } catch (error) {
      if (!shouldQueueChatWrite(error)) rethrowUnlessOfflineQueue(error);
      return queueSend();
    }
  };

  return {
    sendMessage: async (channelId, body, opts) =>
      sendMessageHybrid(channelId, body, opts?.parentId ?? null),
    reply: async (parentId, body) => {
      const parent = await getCachedChatMessage(username, parentId);
      if (!parent) throw new Error(`Unknown message ${parentId}`);
      // RELATED-TO always points at the thread root (single-level threads).
      const rootId = parent.parentId ?? parent.id;
      return sendMessageHybrid(parent.channelId, body, rootId);
    },
    editMessage: async (messageId, body) => {
      const existing = await getCachedChatMessage(username, messageId);
      const optimistic: ChatMessage | undefined = existing
        ? { ...existing, body: body.trim(), editedAt: Date.now() }
        : undefined;
      const queueEdit = async (): Promise<ChatMessage> => {
        if (!optimistic) throw new Error(`Unknown message ${messageId}`);
        await upsertChatMessageInCache(username, optimistic, true);
        await enqueueChatEdit(username, { messageId, body: optimistic.body });
        return optimistic;
      };
      if (!readBrowserOnline()) return queueEdit();
      try {
        const saved = await uiChatMessageForCache(
          username,
          chatMessageFromWire(await patchChatMessage(messageId, { body })),
        );
        await upsertChatMessageInCache(username, saved, false);
        await runner.flush();
        return saved;
      } catch (error) {
        if (isMeetChatGone(error)) {
          await removeChatMessageFromCache(username, messageId);
          throw error;
        }
        if (!shouldQueueChatWrite(error)) rethrowUnlessOfflineQueue(error);
        return queueEdit();
      }
    },
    deleteMessage: async (messageId) => {
      const existing = await getCachedChatMessage(username, messageId);
      const tombstone: ChatMessage | undefined = existing
        ? { ...existing, body: "", deletedAt: Date.now(), previews: [], mentions: [] }
        : undefined;
      const queueDelete = async (): Promise<void> => {
        const { serverDeleteQueued } = await enqueueChatDelete(username, { messageId });
        if (!serverDeleteQueued) {
          // The message only ever existed locally (queued send) — drop it fully.
          await removeChatMessageFromCache(username, messageId);
          return;
        }
        if (tombstone) await upsertChatMessageInCache(username, tombstone, true);
      };
      if (!readBrowserOnline()) return queueDelete();
      try {
        await deleteChatMessage(messageId);
        if (tombstone) await upsertChatMessageInCache(username, tombstone, false);
        await runner.flush();
      } catch (error) {
        if (isMeetChatGone(error)) {
          await removeChatMessageFromCache(username, messageId);
          return;
        }
        if (!shouldQueueChatWrite(error)) rethrowUnlessOfflineQueue(error);
        await queueDelete();
      }
    },
    react: async (messageId, emoji) => {
      const existing = await getCachedChatMessage(username, messageId);
      if (!existing) throw new Error(`Unknown message ${messageId}`);
      const optimistic = toggleReactionLocally(existing, emoji, author.id);
      const queueReact = async (): Promise<ChatMessage> => {
        await upsertChatMessageInCache(username, optimistic, true);
        await enqueueChatReactionToggle(username, { messageId, emoji });
        return optimistic;
      };
      if (!readBrowserOnline()) return queueReact();
      try {
        const saved = await uiChatMessageForCache(
          username,
          chatMessageFromWire(await toggleChatReaction(messageId, emoji)),
        );
        await upsertChatMessageInCache(username, saved, false);
        await runner.flush();
        return saved;
      } catch (error) {
        if (isMeetChatGone(error)) {
          await removeChatMessageFromCache(username, messageId);
          throw error;
        }
        if (!shouldQueueChatWrite(error)) rethrowUnlessOfflineQueue(error);
        return queueReact();
      }
    },
    openDm: async (principalId: string) => {
      // Find-or-create the DM with a workspace principal: cached hit is free
      // (and works offline); otherwise the idempotent POST /chat/dms provisions
      // the collection shared to both members and the row is cached for the
      // rail, sends, and calls.
      const cached = await findCachedDmChannelByPeer(username, principalId);
      if (cached) return meetChannelFromWire(cached);
      if (!readBrowserOnline()) {
        throw new Error("Starting a new direct message requires a connection.");
      }
      const created = await openChatDm(principalId);
      await upsertChatChannelInCache(username, created);
      return meetChannelFromWire(created);
    },
    createChannel: async (input: MeetChannelWriteInput) => {
      if (!readBrowserOnline()) {
        throw new Error("Creating a channel requires a connection.");
      }
      const created = await createChatChannel({
        name: input.name,
        kind: input.kind,
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.groupSlug !== undefined ? { groupSlug: input.groupSlug } : {}),
      });
      await upsertChatChannelInCache(username, created);
      return meetChannelFromWire(created);
    },
    patchChannel: async (channelId, patch) => {
      if (!readBrowserOnline()) {
        throw new Error("Channel settings require a connection.");
      }
      const updated = await patchChatChannel(channelId, wireChannelPatchFromInput(patch));
      await upsertChatChannelInCache(username, updated);
      return meetChannelFromWire(updated);
    },
    patchChannelShareWith: async (channelId, shareWith) => {
      if (!readBrowserOnline()) {
        throw new Error("Sharing requires a connection.");
      }
      const updated = await patchChatChannel(channelId, {
        shareWith: wireShareWithFromCollection(shareWith),
      });
      await upsertChatChannelInCache(username, updated);
      return meetChannelFromWire(updated);
    },
    searchSharePrincipals: (query) => searchCollectionSharePrincipals(query, username),
  };
}

// --- bootstrap -----------------------------------------------------------------------------------

export function meetChatBootstrapFromCached(cached: MeetChatCachedBootstrap): MeetAppBootstrap {
  const channels: MeetChannel[] = cached.channels;
  return {
    session: cached.session,
    data: {
      defaultDisplayName:
        cached.session.user.displayName || cached.session.user.username || "Guest",
      rtc: cached.rtc,
      channels,
      messages: cached.messages,
      dmUnread: cached.dmUnread,
    },
  };
}

/**
 * Live bootstrap: session + RTC settings from the Meet REST surface, chat state
 * from Dexie after an outbox flush and inbound sync (first run backfills the
 * full history of every accessible channel; later runs are incremental).
 */
export async function fetchMeetChatHybridBootstrap(): Promise<MeetAppBootstrap> {
  const base = await fetchMeetLiveBootstrap();
  const username = base.session.user.username;
  if (!username) {
    throw new Error("Meet chat bootstrap missing username");
  }
  // Mentions / DM rail / share-suggestion principals (never throws; not cached
  // offline — offline sessions run without a directory).
  const directoryPromise = fetchMeetChatDirectory();
  await writeMeetChatBootstrapMetaToCache(username, base.session, base.data.rtc);
  if (readBrowserOnline()) {
    await getMeetChatSyncRunner(username).flush();
    await syncMeetChatInboundFromRest(username);
  }
  const cached = await readMeetChatBootstrapFromCache(username);
  const bootstrap = cached
    ? meetChatBootstrapFromCached({ ...cached, session: base.session, rtc: base.data.rtc })
    : base;
  const { directory, groups } = await directoryPromise;
  return {
    ...bootstrap,
    data: { ...bootstrap.data, directory, groups },
  };
}

export async function loadMeetChatBootstrapHybrid(): Promise<MeetAppBootstrap> {
  if (!readBrowserOnline()) {
    const username = readOfflineMeetChatUsername();
    if (username) {
      const cached = await readMeetChatBootstrapFromCache(username);
      if (cached) return meetChatBootstrapFromCached(cached);
    }
    throw new Error("No cached chat available offline");
  }
  return fetchMeetChatHybridBootstrap();
}
