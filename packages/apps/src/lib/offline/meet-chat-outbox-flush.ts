import {
  chatMessageFromWire,
  deleteChatMessage,
  isMeetChatGone,
  patchChatMessage,
  putChatReadMarker,
  sendChatMessage,
  toggleChatReaction,
} from "@/lib/api/wgw/meet-chat";
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
  /** Message ids whose rows errored and stay queued for the next flush. */
  failedMessageIds: string[];
};

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
  const failedMessageIds: string[] = [];

  for (const row of rows) {
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
      const messageId = meetChatOutboxMessageId(row);
      if (messageId) failedMessageIds.push(messageId);
      await markOutboxError(
        username,
        row.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { flushed, failedMessageIds };
}
