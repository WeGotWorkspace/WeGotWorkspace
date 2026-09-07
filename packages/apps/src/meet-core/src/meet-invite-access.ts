import { meetCollectionIdFromPublic, meetPublicChannelId } from "@/meet-core/src/meet-public-id";

/**
 * Invite-link access: one URL for signed-in users and anonymous guests.
 * Signed-in visitors always stay in MeetWorkspace (channel and meeting URLs
 * are the same product). Only signed-out visitors get the guest lobby.
 */

export type MeetInviteAccess = "member" | "signed-in-guest" | "anonymous";

export type MeetInviteAccessChannel = {
  id: string;
  kind?: string | null;
  guestRoomCode?: string | null;
};

export type MeetInviteAccessIo = {
  /** True when a cookie/token session is usable (must not redirect to login). */
  hasSession: () => Promise<boolean>;
  /** ACL read: null means not a member (403/404) or the channel is unknown. */
  getChannel: (channelId: string) => Promise<MeetInviteAccessChannel | null>;
  /** Signed-in channel list for resolving `?room=` (guest codes and chat- ids). */
  listChannels: () => Promise<readonly MeetInviteAccessChannel[]>;
};

export function meetInviteAccessFromProbe(input: {
  signedIn: boolean;
  isChannelMember?: boolean;
}): MeetInviteAccess {
  if (input.signedIn) return "member";
  return "anonymous";
}

export function meetInviteLocksDisplayName(access: MeetInviteAccess): boolean {
  return access === "signed-in-guest";
}

export function meetInviteShowsWorkspace(access: MeetInviteAccess): boolean {
  return access === "member";
}

/** Channel that owns an RTC room (`chat-…` id or meeting `guestRoomCode`). */
export function meetInviteChannelIdForRoom(
  channels: readonly MeetInviteAccessChannel[],
  room: string | null | undefined,
): string | null {
  const needle = room?.trim().toLowerCase();
  if (!needle) return null;
  const match = channels.find((channel) => {
    const guest = channel.guestRoomCode?.trim().toLowerCase();
    if (guest && guest === needle) return true;
    const id = channel.id.trim().toLowerCase();
    return id === needle || meetPublicChannelId(id) === needle;
  });
  return match?.id ?? null;
}

export type MeetInviteDestination = {
  access: MeetInviteAccess;
  /** Workspace channel id when the room maps to a chat channel the user can open. */
  channelId: string | null;
  /** Collection kind when known — meeting-kind members go to `/meet/meetings/{id}`. */
  kind?: string | null;
};

/**
 * Decide workspace vs guest lobby. Never throws — session failures fall
 * through to the lobby so guests are not bounced to login. Signed-in users
 * never leave MeetWorkspace: a 403/404 on a channel is not a guest landing.
 */
export async function resolveMeetInviteDestination(
  input: { room: string | null; channelId?: string | null },
  io: MeetInviteAccessIo,
): Promise<MeetInviteDestination> {
  const requestedChannelId = input.channelId?.trim()
    ? meetCollectionIdFromPublic(input.channelId)
    : null;
  const room = input.room?.trim() || requestedChannelId;

  let signedIn = false;
  try {
    signedIn = await io.hasSession();
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    return {
      access: "anonymous",
      channelId: requestedChannelId,
    };
  }

  if (requestedChannelId) {
    return { access: "member", channelId: requestedChannelId };
  }

  if (!room) {
    return { access: "member", channelId: null };
  }

  let channels: readonly MeetInviteAccessChannel[] = [];
  try {
    channels = await io.listChannels();
  } catch {
    channels = [];
  }
  const channelId = meetInviteChannelIdForRoom(channels, room);
  const kind = channelId ? (channels.find((row) => row.id === channelId)?.kind ?? null) : undefined;
  return {
    access: "member",
    channelId,
    ...(kind ? { kind } : {}),
  };
}
