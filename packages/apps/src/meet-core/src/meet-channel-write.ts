import { createMeetRoomCode } from "@/meet-core/src/meet-room-id";
import type {
  MeetChannel,
  MeetChannelPatchInput,
  MeetChannelWriteInput,
} from "@/meet-core/src/meet-types";

export const DEFAULT_MEET_CHANNEL_COLOR = "#2a1644";

function nextChannelId(kind: MeetChannelWriteInput["kind"]): string {
  return `${kind}-${crypto.randomUUID()}`;
}

export function buildMeetChannel(input: MeetChannelWriteInput): MeetChannel {
  const meeting = input.kind === "meeting";
  return {
    id: nextChannelId(input.kind),
    name: input.name.trim(),
    color: input.color ?? DEFAULT_MEET_CHANNEL_COLOR,
    kind: input.kind,
    scope: input.groupSlug ? "group" : "personal",
    groupSlug: input.groupSlug ?? null,
    isSharee: false,
    shareWith: null,
    guestAccess: meeting,
    guestRoomCode: meeting ? createMeetRoomCode() : null,
    myRights: { mayReadItems: true, mayWriteAll: true, mayShare: true, mayDelete: true },
  };
}

export function applyMeetChannelPatch(
  channel: MeetChannel,
  patch: MeetChannelPatchInput,
): MeetChannel {
  const groupSlug = patch.groupSlug === undefined ? channel.groupSlug : patch.groupSlug;
  return {
    ...channel,
    name: patch.name?.trim() || channel.name,
    color: patch.color === undefined ? channel.color : patch.color,
    groupSlug,
    scope: groupSlug ? "group" : "personal",
    shareWith: patch.shareWith === undefined ? channel.shareWith : patch.shareWith,
  };
}

/**
 * Owner delete in the channel dialog — same gate as Notes `canDeleteNotebook`.
 * Sharees must not see destroy (`myRights.mayDelete: false` on inbound shares).
 */
export function canDeleteMeetChannel(channel?: {
  isSharee?: boolean;
  myRights?: { mayDelete?: boolean } | null;
}): boolean {
  if (!channel) return false;
  if (channel.isSharee === true) return false;
  if (channel.myRights?.mayDelete === false) return false;
  return true;
}
