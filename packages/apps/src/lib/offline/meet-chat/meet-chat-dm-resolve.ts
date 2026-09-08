/**
 * Virtual→real DM channel resolution for outbound REST calls (chunk G).
 *
 * Split from meet-chat-dm.ts (pure helpers) because this side needs the REST
 * client and the Dexie store — meet-chat-offline-store imports the pure
 * helpers, so keeping the store/REST imports here avoids a module cycle.
 */
import { openChatDm } from "@/lib/api/wgw/meet-chat";
import {
  findCachedDmChannelByPeer,
  upsertChatChannelInCache,
} from "@/lib/offline/meet-chat-offline-store";
import { meetDirectMessagePrincipalId } from "@/meet-core/src/meet-direct-messages";

/**
 * REST target for a UI channel id. Non-DM ids pass through; `dm:{peer}` ids
 * resolve to the real `dm-{hash}` collection — from the Dexie cache when the
 * DM was provisioned before, otherwise via the idempotent find-or-create
 * endpoint (the result is cached for every later send/marker/call).
 */
export async function resolveRestChannelId(username: string, channelId: string): Promise<string> {
  const peer = meetDirectMessagePrincipalId(channelId);
  if (!peer) return channelId;
  const cached = await findCachedDmChannelByPeer(username, peer);
  if (cached) return cached.id;
  const created = await openChatDm(peer);
  await upsertChatChannelInCache(username, created);
  return created.id;
}
