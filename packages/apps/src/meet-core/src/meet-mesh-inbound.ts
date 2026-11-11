import { ingestRemoteChatMessage } from "@/lib/offline/meet-chat-jmap-inbound";
import { findCachedChannelForUiId } from "@/lib/offline/meet-chat/meet-chat-read-marker";
import { upsertChatChannelInCache } from "@/lib/offline/meet-chat-offline-store";
import { meetMeshSenderMayHint } from "@/meet-core/src/meet-mesh-fanout-targets";
import {
  meetMeshChatMessageToApp,
  meetMeshReceiveChannelId,
} from "@/meet-core/src/meet-mesh-message";
import { meetDirectMessagePrincipalId } from "@/meet-core/src/meet-direct-messages";
import type { MeetChannel } from "@/lib/models/meet-types";
import type { PresenceChannelMessage } from "@/presence-core/src/presence-types";

export type MeetMeshChannelAcl = {
  channels?: readonly MeetChannel[];
  /** The receiving user; a payload for a channel they are not a member of is dropped. */
  self?: string | null;
};

export function acceptMeetMeshChannel(
  channelId: string,
  knownChannelIds: ReadonlySet<string>,
): boolean {
  if (meetDirectMessagePrincipalId(channelId)) return true;
  return knownChannelIds.has(channelId);
}

/** Receiver already knows the channel, and sender and receiver are both on its roster. */
export function acceptMeetMeshSender(
  channelId: string,
  senderUsername: string,
  knownChannelIds: ReadonlySet<string>,
  acl?: MeetMeshChannelAcl,
): boolean {
  if (!acceptMeetMeshChannel(channelId, knownChannelIds)) return false;
  return meetMeshSenderMayHint({
    channelId,
    senderUsername,
    selfUsername: acl?.self,
    channels: acl?.channels,
  });
}

export async function applyMeetMeshChatMessage(args: {
  username: string;
  senderUsername: string;
  message: PresenceChannelMessage;
  knownChannelIds: ReadonlySet<string>;
  acl?: MeetMeshChannelAcl;
}): Promise<"applied" | "dropped"> {
  const channelId = meetMeshReceiveChannelId(args.message.channelId, args.senderUsername);
  if (!acceptMeetMeshSender(channelId, args.senderUsername, args.knownChannelIds, args.acl)) {
    return "dropped";
  }
  const app = meetMeshChatMessageToApp({ ...args.message, channelId });
  const result = await ingestRemoteChatMessage(args.username, app);
  if (result === "skipped-pending") return "dropped";
  if (app.authorId !== args.username) {
    const wire = await findCachedChannelForUiId(args.username, channelId);
    if (wire) {
      await upsertChatChannelInCache(args.username, {
        ...wire,
        unreadCount: (wire.unreadCount ?? 0) + 1,
      });
    }
  }
  return "applied";
}

export function meetMeshReceiveCallChannelId(channelId: string, senderUsername: string): string {
  return meetMeshReceiveChannelId(channelId, senderUsername);
}
