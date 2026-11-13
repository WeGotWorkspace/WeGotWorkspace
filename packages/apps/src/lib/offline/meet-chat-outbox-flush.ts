import {
  chatMessageFromWire,
  deleteChatMessage,
  isMeetChatGone,
  patchChatMessage,
  putChatReadMarker,
  sendChatMessage,
  toggleChatReaction,
} from "@/lib/api/wgw/meet-chat";
import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";
import { getOutboxMutation, rebaseQueuedEntityRows } from "@/lib/offline/core/outbox-store";
import { MEET_CHAT_DOMAIN } from "@/lib/offline/meet-chat/meet-chat-schema";
import { notifyMeetChatCacheChanged } from "@/lib/offline/meet-chat/meet-chat-cache-changed";
import { resolveRestChannelId } from "@/lib/offline/meet-chat/meet-chat-dm-resolve";
import {
  listMeetChatOutbox,
  markOutboxError,
  meetChatOutboxMessageId,
  removeChatMessageFromCache,
  removeOutboxMutation,
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

/**
 * Replay queued chat mutations oldest-first. Replay is idempotent by contract:
 *
 * - `send` retries carry the same client ULID; the server returns the existing
 *   message instead of duplicating it.
 * - `delete` is a tombstone: a 404 counts as success (already gone).
 * - `edit` on a 404 drops local state — the message was deleted remotely.
 * - `react` replays the queued toggles (offline pair-cancel already removed
 *   net-zero toggles at enqueue time).
 * - `readMarker` PUTs are naturally last-write-wins.
 */
export async function flushMeetChatOutbox(username: string): Promise<MeetChatOutboxFlushResult> {
  const rows = await listMeetChatOutbox(username);
  let flushed = 0;
  let failed = 0;

  for (const listed of rows) {
    // Re-read: a send the server re-keyed rebases the rows queued behind it.
    const row = await getOutboxMutation(username, listed.id);
    if (!row) continue;
    try {
      if (row.op === "send") {
        const payload = JSON.parse(row.payload) as MeetChatSendOutboxPayload;
        try {
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
          await upsertChatMessageInCache(
            username,
            await uiChatMessageForCache(username, chatMessageFromWire(saved)),
            false,
          );
        } catch (error) {
          if (!isMeetChatGone(error)) throw error;
          // Channel deleted remotely — the queued message has no home anymore.
          await removeChatMessageFromCache(username, payload.messageId);
        }
      } else if (row.op === "edit") {
        const payload = JSON.parse(row.payload) as MeetChatEditOutboxPayload;
        try {
          const saved = await patchChatMessage(payload.messageId, { body: payload.body });
          await upsertChatMessageInCache(
            username,
            await uiChatMessageForCache(username, chatMessageFromWire(saved)),
            false,
          );
        } catch (error) {
          if (!isMeetChatGone(error)) throw error;
          await removeChatMessageFromCache(username, payload.messageId);
        }
      } else if (row.op === "delete") {
        const payload = JSON.parse(row.payload) as MeetChatDeleteOutboxPayload;
        try {
          await deleteChatMessage(payload.messageId);
        } catch (error) {
          if (!isMeetChatGone(error)) throw error;
        }
      } else if (row.op === "react") {
        const payload = JSON.parse(row.payload) as MeetChatReactOutboxPayload;
        try {
          const saved = await toggleChatReaction(payload.messageId, payload.emoji);
          await upsertChatMessageInCache(
            username,
            await uiChatMessageForCache(username, chatMessageFromWire(saved)),
            false,
          );
        } catch (error) {
          if (!isMeetChatGone(error)) throw error;
          await removeChatMessageFromCache(username, payload.messageId);
        }
      } else if (row.op === "readMarker") {
        const payload = JSON.parse(row.payload) as MeetChatReadMarkerOutboxPayload;
        await putChatReadMarker(await resolveRestChannelId(username, payload.channelId), {
          lastReadTs: payload.lastReadTs,
          lastReadUid: payload.lastReadUid,
        });
      }
      await removeOutboxMutation(username, row.id);
      flushed += 1;
    } catch (error) {
      failed += 1;
      await markOutboxError(
        username,
        row.id,
        error instanceof Error ? error.message : String(error),
        httpStatusFromFlushError(error),
      );
    }
  }

  if (rows.length > 0) notifyMeetChatCacheChanged(username);
  return { flushed, failed };
}
