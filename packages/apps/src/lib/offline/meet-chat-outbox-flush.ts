import {
  chatMessageFromWire,
  deleteChatMessage,
  isMeetChatGone,
  patchChatMessage,
  putChatReadMarker,
  sendChatMessage,
  toggleChatReaction,
} from "@/lib/api/wgw/meet-chat";
import { runOutboxFlush } from "@/lib/offline/core/outbox-flush";
import { getOutboxMutation, rebaseQueuedEntityRows } from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { MEET_CHAT_DOMAIN } from "@/lib/offline/meet-chat/meet-chat-schema";
import { notifyMeetChatCacheChanged } from "@/lib/offline/meet-chat/meet-chat-cache-changed";
import { resolveRestChannelId } from "@/lib/offline/meet-chat/meet-chat-dm-resolve";
import {
  meetChatOutboxMessageId,
  removeChatMessageFromCache,
  uiChatMessageForCache,
  upsertChatMessageInCache,
  type MeetChatDeleteOutboxPayload,
  type MeetChatEditOutboxPayload,
  type MeetChatReactOutboxPayload,
  type MeetChatReadMarkerOutboxPayload,
  type MeetChatSendOutboxPayload,
} from "@/lib/offline/meet-chat-offline-store";

export type MeetChatOutboxFlushResult = {
  /** Rows replayed and removed. */
  flushed: number;
  /**
   * Rows that errored and stay queued. Which messages failed is read from the
   * outbox rows themselves (`readMeetChatBootstrapFromCache` sets each
   * message's `syncState`), so every tab sees it, also after a reload.
   */
  failed: number;
};

/**
 * A send the server answered with another id: the edits, deletes and
 * reactions queued behind it name the old id, so they follow the new one
 * instead of getting a 404 and being dropped.
 */
async function followReKeyedSend(
  username: string,
  sentRowId: string,
  localId: string,
  serverId: string,
): Promise<void> {
  await rebaseQueuedEntityRows(username, {
    domain: MEET_CHAT_DOMAIN,
    entityId: localId,
    sentRowId,
    entityIdFromRow: meetChatOutboxMessageId,
    rebase: (queued) => ({
      ...queued,
      payload: JSON.stringify({ ...JSON.parse(queued.payload), messageId: serverId }),
    }),
  });
}

/** Puts the message the server answered into the cache, marked as synced. */
async function cacheSavedMessage(
  username: string,
  saved: Parameters<typeof chatMessageFromWire>[0],
): Promise<void> {
  await upsertChatMessageInCache(
    username,
    await uiChatMessageForCache(username, chatMessageFromWire(saved)),
    false,
  );
}

/**
 * Runs a send whose message is gone on the server (`isMeetChatGone`): `onGone`
 * cleans up and the row counts as sent. Any other error stays a failed send.
 */
async function unlessGone(send: () => Promise<void>, onGone: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (error) {
    if (!isMeetChatGone(error)) throw error;
    await onGone();
  }
}

async function sendQueuedMessage(
  username: string,
  row: OfflineOutboxRow,
  payload: MeetChatSendOutboxPayload,
): Promise<void> {
  await unlessGone(
    async () => {
      // Offline DM sends queue under the virtual `dm:{peer}` id — the dm-
      // collection is found-or-created (idempotent) at flush time.
      const restChannelId = await resolveRestChannelId(username, payload.channelId);
      const saved = await sendChatMessage(restChannelId, {
        id: payload.messageId,
        body: payload.body,
        ...(payload.parentId ? { parentId: payload.parentId } : {}),
      });
      // The server keeps the client ULID unless an object out of this
      // person's reach already has it; then the answer carries a fresh id.
      if (saved.id !== payload.messageId) {
        await removeChatMessageFromCache(username, payload.messageId);
        await followReKeyedSend(username, row.id, payload.messageId, saved.id);
      }
      await cacheSavedMessage(username, saved);
    },
    // Channel deleted remotely — the queued message has no home anymore.
    () => removeChatMessageFromCache(username, payload.messageId),
  );
}

async function sendMeetChatRow(
  username: string,
  row: OfflineOutboxRow,
  payload: unknown,
): Promise<void> {
  if (row.op === "send") {
    await sendQueuedMessage(username, row, payload as MeetChatSendOutboxPayload);
  } else if (row.op === "edit") {
    const edit = payload as MeetChatEditOutboxPayload;
    await unlessGone(
      async () =>
        cacheSavedMessage(username, await patchChatMessage(edit.messageId, { body: edit.body })),
      () => removeChatMessageFromCache(username, edit.messageId),
    );
  } else if (row.op === "delete") {
    const { messageId } = payload as MeetChatDeleteOutboxPayload;
    // A tombstone: already gone counts as deleted.
    await unlessGone(
      () => deleteChatMessage(messageId),
      async () => {},
    );
  } else if (row.op === "react") {
    const react = payload as MeetChatReactOutboxPayload;
    await unlessGone(
      async () =>
        cacheSavedMessage(username, await toggleChatReaction(react.messageId, react.emoji)),
      () => removeChatMessageFromCache(username, react.messageId),
    );
  } else if (row.op === "readMarker") {
    const marker = payload as MeetChatReadMarkerOutboxPayload;
    await putChatReadMarker(await resolveRestChannelId(username, marker.channelId), {
      lastReadTs: marker.lastReadTs,
      lastReadUid: marker.lastReadUid,
    });
  }
}

/**
 * Replay queued chat mutations oldest-first, through the shared runner
 * (`runOutboxFlush`). Replay is idempotent by contract:
 *
 * - `send` retries carry the same client ULID; the server returns the existing
 *   message instead of duplicating it.
 * - `delete` is a tombstone: a 404 counts as success (already gone).
 * - `edit` on a 404 drops local state — the message was deleted remotely.
 * - `react` replays the queued toggles (offline pair-cancel already removed
 *   net-zero toggles at enqueue time).
 * - `readMarker` PUTs are naturally last-write-wins.
 *
 * A failed send keeps its row with the error and status (the runner's record).
 */
export async function flushMeetChatOutbox(username: string): Promise<MeetChatOutboxFlushResult> {
  let listedAny = false;
  const counts = await runOutboxFlush<unknown>(username, {
    domain: MEET_CHAT_DOMAIN,
    // Re-read: a send the server re-keyed rebases the rows queued behind it.
    prepare: async (listed) => {
      listedAny = true;
      return (await getOutboxMutation(username, listed.id)) ?? null;
    },
    // An unreadable payload throws, so the row stays queued as a failed send.
    parse: (row) => JSON.parse(row.payload) as unknown,
    send: (payload, row) => sendMeetChatRow(username, row, payload),
  });

  if (listedAny) notifyMeetChatCacheChanged(username);
  return counts;
}
