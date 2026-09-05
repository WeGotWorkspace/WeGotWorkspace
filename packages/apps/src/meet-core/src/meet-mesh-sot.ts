/**
 * Meet mesh acceleration — single source of truth.
 *
 * Server REST + JMAP / room-status poll stay authoritative. This module owns
 * every hint we put on the principal presence mesh: apply (Dexie ingest) and
 * wrap (fan out after a successful local write). Payloads are untrusted —
 * `authorId` / reactor must match the signaling sender; unknown channels are
 * dropped unless the kind is a `channel-changed` ping (then REST decides).
 */
import {
  getChatChannel,
  isMeetChatGone,
  meetChatHttpStatus,
  type WgwChatChannel,
} from "@/lib/api/wgw/meet-chat";
import {
  ingestRemoteChatChannel,
  ingestRemoteChatChannelDestroyed,
  ingestRemoteChatMessage,
} from "@/lib/offline/meet-chat-jmap-inbound";
import {
  getCachedChatMessage,
  upsertChatMessageInCache,
} from "@/lib/offline/meet-chat-offline-store";
import { isMeetDirectMessageChannelId } from "@/meet-core/src/meet-direct-messages";
import { acceptMeetMeshChannel, applyMeetMeshChatMessage } from "@/meet-core/src/meet-mesh-inbound";
import {
  meetMeshChatMessageFromApp,
  meetMeshReceiveChannelId,
} from "@/meet-core/src/meet-mesh-message";
import type { ChatMessage, MeetChannel, MeetChatOperations } from "@/meet-core/src/meet-types";
import type { PresenceEnvelope, PresenceMeetFanoutEvent } from "@/presence-core/src/presence-types";

export type MeetMeshApplyResult = "applied" | "dropped";

export type MeetMeshFetchChannel = (channelId: string) => Promise<WgwChatChannel>;

function isForbidden(error: unknown): boolean {
  return meetChatHttpStatus(error) === 403;
}

function receiveChannelId(channelId: string, senderUsername: string): string {
  return meetMeshReceiveChannelId(channelId, senderUsername);
}

function applyReaction(
  message: ChatMessage,
  emoji: string,
  authorId: string,
  on: boolean,
): ChatMessage {
  const reactions = message.reactions.map((row) => ({ ...row, authors: [...row.authors] }));
  const existing = reactions.find((row) => row.emoji === emoji);
  if (on) {
    if (!existing) reactions.push({ emoji, authors: [authorId] });
    else if (!existing.authors.includes(authorId)) existing.authors.push(authorId);
  } else if (existing) {
    existing.authors = existing.authors.filter((id) => id !== authorId);
  }
  return { ...message, reactions: reactions.filter((row) => row.authors.length > 0) };
}

async function bumpParentReplyCount(username: string, parentId: string | null | undefined) {
  if (!parentId) return;
  const parent = await getCachedChatMessage(username, parentId);
  if (!parent) return;
  await upsertChatMessageInCache(username, {
    ...parent,
    replyCount: (parent.replyCount ?? 0) + 1,
  });
}

async function applyMessage(
  username: string,
  senderUsername: string,
  message: PresenceMeetFanoutEvent & { kind: "channel-message" },
  knownChannelIds: ReadonlySet<string>,
): Promise<MeetMeshApplyResult> {
  const had = await getCachedChatMessage(username, message.message.id);
  const result = await applyMeetMeshChatMessage({
    username,
    senderUsername,
    message: message.message,
    knownChannelIds,
  });
  if (result !== "applied" || had) return result;
  await bumpParentReplyCount(username, message.message.parentId);
  return result;
}

async function applyPatch(
  username: string,
  event: PresenceMeetFanoutEvent & { kind: "channel-message-patch" },
  knownChannelIds: ReadonlySet<string>,
): Promise<MeetMeshApplyResult> {
  const channelId = receiveChannelId(event.channel, event.senderUsername);
  if (!acceptMeetMeshChannel(channelId, knownChannelIds)) return "dropped";
  const existing = await getCachedChatMessage(username, event.id);
  if (!existing || existing.authorId !== event.senderUsername) return "dropped";
  const result = await ingestRemoteChatMessage(username, {
    ...existing,
    body: event.body,
    editedAt: event.editedAt,
  });
  return result === "upserted" ? "applied" : "dropped";
}

async function applyDestroy(
  username: string,
  event: PresenceMeetFanoutEvent & { kind: "channel-message-destroy" },
  knownChannelIds: ReadonlySet<string>,
): Promise<MeetMeshApplyResult> {
  const channelId = receiveChannelId(event.channel, event.senderUsername);
  if (!acceptMeetMeshChannel(channelId, knownChannelIds)) return "dropped";
  const existing = await getCachedChatMessage(username, event.id);
  if (!existing || existing.authorId !== event.senderUsername) return "dropped";
  const result = await ingestRemoteChatMessage(username, {
    ...existing,
    body: "",
    deletedAt: Date.now(),
    previews: [],
    mentions: [],
  });
  return result === "upserted" ? "applied" : "dropped";
}

async function applyReactionEvent(
  username: string,
  event: PresenceMeetFanoutEvent & { kind: "channel-reaction" },
  knownChannelIds: ReadonlySet<string>,
): Promise<MeetMeshApplyResult> {
  const channelId = receiveChannelId(event.channel, event.senderUsername);
  if (!acceptMeetMeshChannel(channelId, knownChannelIds)) return "dropped";
  const existing = await getCachedChatMessage(username, event.messageId);
  if (!existing) return "dropped";
  const result = await ingestRemoteChatMessage(
    username,
    applyReaction(existing, event.emoji, event.senderUsername, event.on),
  );
  return result === "upserted" ? "applied" : "dropped";
}

async function applyChannelChanged(
  username: string,
  event: PresenceMeetFanoutEvent & { kind: "channel-changed" },
  fetchChannel: MeetMeshFetchChannel,
): Promise<MeetMeshApplyResult> {
  const channelId = receiveChannelId(event.channel, event.senderUsername);
  if (isMeetDirectMessageChannelId(channelId)) return "dropped";
  try {
    const wire = await fetchChannel(channelId);
    await ingestRemoteChatChannel(username, wire);
    return "applied";
  } catch (error) {
    if (!isMeetChatGone(error) && !isForbidden(error)) return "dropped";
    await ingestRemoteChatChannelDestroyed(username, channelId);
    return "applied";
  }
}

/**
 * Apply one inbound Meet mesh event to the Dexie cache.
 * `call-active` is UI state (not Dexie) — the hook handles it.
 */
export async function applyMeetMeshFanoutEvent(args: {
  username: string;
  event: PresenceMeetFanoutEvent;
  knownChannelIds: ReadonlySet<string>;
  fetchChannel?: MeetMeshFetchChannel;
}): Promise<MeetMeshApplyResult> {
  const { username, event, knownChannelIds } = args;
  if (event.kind === "call-active") return "dropped";
  if (event.kind === "channel-message") {
    return applyMessage(username, event.senderUsername, event, knownChannelIds);
  }
  if (event.kind === "channel-message-patch") {
    return applyPatch(username, event, knownChannelIds);
  }
  if (event.kind === "channel-message-destroy") {
    return applyDestroy(username, event, knownChannelIds);
  }
  if (event.kind === "channel-reaction") {
    return applyReactionEvent(username, event, knownChannelIds);
  }
  return applyChannelChanged(username, event, args.fetchChannel ?? getChatChannel);
}

function reactionIsOn(message: ChatMessage, emoji: string, authorId: string): boolean {
  return message.reactions.some((row) => row.emoji === emoji && row.authors.includes(authorId));
}

export type MeetMeshFanoutPort = {
  sendToUsernames: (usernames: readonly string[], envelope: PresenceEnvelope) => void;
  targetsFor: (channelId: string, snapshots?: readonly MeetChannel[]) => string[];
  resolveMessage: (messageId: string) => Promise<ChatMessage | undefined>;
};

/** Wrap chat operations so every successful write fans out the matching hint. */
export function wrapMeetChatOperationsWithMesh(
  operations: MeetChatOperations,
  selfUsername: string | null | undefined,
  liveCallChannelId: string | null | undefined,
  port: MeetMeshFanoutPort,
): MeetChatOperations {
  const self = selfUsername?.trim() ?? "";
  const send = (
    channelId: string,
    envelope: PresenceEnvelope,
    snapshots?: readonly MeetChannel[],
  ) => {
    port.sendToUsernames(port.targetsFor(channelId, snapshots), envelope);
  };

  return {
    ...operations,
    sendMessage: operations.sendMessage
      ? async (channelId, body, opts) => {
          const saved = await operations.sendMessage!(channelId, body, opts);
          send(saved.channelId, {
            v: 1,
            kind: "channel-message",
            message: meetMeshChatMessageFromApp(saved),
          });
          return saved;
        }
      : undefined,
    reply: operations.reply
      ? async (parentId, body) => {
          const saved = await operations.reply!(parentId, body);
          send(saved.channelId, {
            v: 1,
            kind: "channel-message",
            message: meetMeshChatMessageFromApp(saved),
          });
          return saved;
        }
      : undefined,
    editMessage: operations.editMessage
      ? async (messageId, body) => {
          const saved = await operations.editMessage!(messageId, body);
          send(saved.channelId, {
            v: 1,
            kind: "channel-message-patch",
            id: saved.id,
            channel: saved.channelId,
            body: saved.body,
            editedAt: saved.editedAt ?? Date.now(),
          });
          return saved;
        }
      : undefined,
    deleteMessage: operations.deleteMessage
      ? async (messageId) => {
          const prior = await port.resolveMessage(messageId);
          await operations.deleteMessage!(messageId);
          if (prior) {
            send(prior.channelId, {
              v: 1,
              kind: "channel-message-destroy",
              id: prior.id,
              channel: prior.channelId,
            });
          }
        }
      : undefined,
    react: operations.react
      ? async (messageId, emoji) => {
          const saved = await operations.react!(messageId, emoji);
          if (self) {
            send(saved.channelId, {
              v: 1,
              kind: "channel-reaction",
              messageId: saved.id,
              channel: saved.channelId,
              emoji,
              on: reactionIsOn(saved, emoji, self),
            });
          }
          return saved;
        }
      : undefined,
    createChannel: operations.createChannel
      ? async (input) => {
          const created = await operations.createChannel!(input);
          send(created.id, { v: 1, kind: "channel-changed", channel: created.id }, [created]);
          return created;
        }
      : undefined,
    patchChannel: operations.patchChannel
      ? async (channelId, patch) => {
          const updated = await operations.patchChannel!(channelId, patch);
          send(updated.id, { v: 1, kind: "channel-changed", channel: updated.id }, [updated]);
          return updated;
        }
      : undefined,
    patchChannelShareWith: operations.patchChannelShareWith
      ? async (channelId, shareWith) => {
          const updated = await operations.patchChannelShareWith!(channelId, shareWith);
          send(updated.id, { v: 1, kind: "channel-changed", channel: updated.id }, [updated]);
          return updated;
        }
      : undefined,
    startCall: operations.startCall
      ? async (channelId) => {
          await operations.startCall!(channelId);
          send(channelId, { v: 1, kind: "call-active", channel: channelId, active: true });
        }
      : undefined,
    leaveCall: operations.leaveCall
      ? async (channelId) => {
          await operations.leaveCall!(channelId);
          const target = channelId || liveCallChannelId || "";
          if (target) send(target, { v: 1, kind: "call-active", channel: target, active: false });
        }
      : undefined,
  };
}
