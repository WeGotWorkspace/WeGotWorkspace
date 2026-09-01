import { createMeetRoomCode } from "@/meet-core/src/meet-room-id";
import type {
  MeetChannel,
  MeetChannelPatchInput,
  MeetChannelWriteInput,
} from "@/meet-core/src/meet-types";

export const DEFAULT_MEET_CHANNEL_COLOR = "#06b6d4";

function nextChannelId(kind: MeetChannelWriteInput["kind"]): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
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
