import type { MeetChannel } from "@/meet-core/src/meet-types";
import { meetDirectMessagePrincipalId } from "@/meet-core/src/meet-direct-messages";
import { shareGrantEntries, type CollectionSharePrincipal } from "@/share-ui/collection-share";

/**
 * Usernames that may receive a Meet mesh payload for this conversation.
 *
 * Never the whole presence roster: the workspace mesh includes every online
 * coworker, including people outside the channel ACL. DMs go to the one peer.
 * Explicit `shareWith` user grants go to those users. Group-owned channels
 * (`groupSlug`) have no member list on the client yet — we fan out to
 * directory *user* principals (the same people as the DM rail) and the
 * receiver still drops the payload if the channel is not in their Dexie ACL
 * cache. Group grants in `shareWith` cannot be expanded and do not widen
 * the set by themselves.
 */
export function meetMeshFanoutUsernames(args: {
  channelId: string;
  selfUsername: string | null | undefined;
  channels?: readonly MeetChannel[];
  directory?: readonly CollectionSharePrincipal[];
}): string[] {
  const self = args.selfUsername?.trim() ?? "";
  const targets = new Set<string>();

  const peer = meetDirectMessagePrincipalId(args.channelId);
  if (peer) {
    if (peer !== self) targets.add(peer);
    return [...targets];
  }

  const channel = args.channels?.find((row) => row.id === args.channelId);
  for (const grant of shareGrantEntries(channel?.shareWith)) {
    if (!grant.isGroup && grant.id && grant.id !== self) targets.add(grant.id);
  }

  if (channel?.groupSlug) {
    for (const principal of args.directory ?? []) {
      if (principal.principalType !== "user" || !principal.id || principal.id === self) continue;
      targets.add(principal.id);
    }
  }

  return [...targets];
}

/**
 * Whether the transport-authenticated sender may hint into this conversation.
 *
 * Mirrors {@link meetMeshFanoutUsernames}: DMs only from the peer; named
 * channels only from a user grant in local `shareWith`; group-owned channels
 * also from a directory *user* (same expansion as send). Group grants in
 * `shareWith` cannot be expanded. Unknown / empty membership is fail-closed.
 */
export function meetMeshSenderMayHint(args: {
  channelId: string;
  senderUsername: string;
  channels?: readonly MeetChannel[];
  directory?: readonly CollectionSharePrincipal[];
}): boolean {
  const sender = args.senderUsername.trim();
  if (!sender) return false;

  const peer = meetDirectMessagePrincipalId(args.channelId);
  if (peer) return peer === sender;

  const channel = args.channels?.find((row) => row.id === args.channelId);
  if (!channel) return false;

  for (const grant of shareGrantEntries(channel.shareWith)) {
    if (!grant.isGroup && grant.id === sender) return true;
  }

  if (!channel.groupSlug) return false;
  return (args.directory ?? []).some(
    (principal) => principal.principalType === "user" && principal.id === sender,
  );
}

/** Union of `meetMeshFanoutUsernames` across snapshots (share add/remove, create). */
export function meetMeshFanoutUsernamesUnion(
  args: Omit<Parameters<typeof meetMeshFanoutUsernames>[0], "channelId" | "channels">,
  snapshots: readonly MeetChannel[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const snapshot of snapshots) {
    for (const name of meetMeshFanoutUsernames({
      ...args,
      channelId: snapshot.id,
      channels: [snapshot],
    })) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
