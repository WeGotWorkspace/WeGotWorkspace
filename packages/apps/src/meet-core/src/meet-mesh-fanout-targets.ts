import type { MeetChannel } from "@/meet-core/src/meet-types";
import { meetDirectMessagePrincipalId } from "@/meet-core/src/meet-direct-messages";
import { shareGrantEntries } from "@/lib/sharing/collection-share";

function normalize(username: string | null | undefined): string {
  return username?.trim().toLowerCase() ?? "";
}

/**
 * The users who may read this channel, as far as the local cache knows.
 *
 * `members` is the server roster (owner side plus sharees, groups expanded).
 * A row cached before the server sent `members` falls back to the explicit
 * user grants in `shareWith`. Never the workspace directory: the presence mesh
 * reaches every online coworker, and most of them cannot read the channel.
 */
function channelReaders(channel: MeetChannel): string[] {
  if (channel.members) return channel.members.map(normalize).filter(Boolean);
  return shareGrantEntries(channel.shareWith)
    .filter((grant) => !grant.isGroup && grant.id)
    .map((grant) => normalize(grant.id));
}

/**
 * Usernames that may receive a Meet mesh payload for this conversation.
 *
 * DMs go to the one peer. Channels go to their readers (see
 * {@link channelReaders}). An unknown channel goes to nobody: the server's
 * push delivers the change instead.
 */
export function meetMeshFanoutUsernames(args: {
  channelId: string;
  selfUsername: string | null | undefined;
  channels?: readonly MeetChannel[];
}): string[] {
  const self = normalize(args.selfUsername);
  const targets = new Set<string>();

  const peer = meetDirectMessagePrincipalId(args.channelId);
  if (peer) {
    if (normalize(peer) !== self) targets.add(peer);
    return [...targets];
  }

  const channel = args.channels?.find((row) => row.id === args.channelId);
  if (!channel) return [];
  for (const reader of channelReaders(channel)) {
    if (reader !== self) targets.add(reader);
  }
  return [...targets];
}

/**
 * Whether the receiver may take this mesh payload from this sender.
 *
 * Mirrors {@link meetMeshFanoutUsernames}: DMs only from the peer; channels
 * only when the sender is a reader, and — when the receiver's own name is
 * given — the receiver is one too. A payload for a channel the receiver may
 * not read is dropped before anything is stored. Unknown or empty membership
 * is fail-closed.
 */
export function meetMeshSenderMayHint(args: {
  channelId: string;
  senderUsername: string;
  selfUsername?: string | null;
  channels?: readonly MeetChannel[];
}): boolean {
  const sender = normalize(args.senderUsername);
  if (!sender) return false;

  const peer = meetDirectMessagePrincipalId(args.channelId);
  if (peer) return normalize(peer) === sender;

  const channel = args.channels?.find((row) => row.id === args.channelId);
  if (!channel) return false;

  const readers = channelReaders(channel);
  if (!readers.includes(sender)) return false;
  const self = normalize(args.selfUsername);
  if (self && channel.members && !readers.includes(self)) return false;
  return true;
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
