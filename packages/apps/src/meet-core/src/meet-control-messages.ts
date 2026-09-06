export type MeetControlMessage =
  | { kind: "knock"; peerId: string; name: string }
  | { kind: "admit"; peerId: string }
  | { kind: "deny"; peerId: string }
  | { kind: "end"; by: string }
  | { kind: "mute"; peerId: string }
  | { kind: "media"; mic: boolean; camera: boolean; screen?: boolean };

export const MEET_KNOCK_NAME_PREFIX = "__wgw_knock__:";
const MEET_CONTROL_PREFIX = "__wgw_meet_control__:";

export function encodeMeetKnockerName(displayName: string): string {
  const safeName = displayName.trim() || "Guest";
  return `${MEET_KNOCK_NAME_PREFIX}${safeName}`;
}

export function decodeMeetKnockerName(peerName: string): string | null {
  if (!peerName.startsWith(MEET_KNOCK_NAME_PREFIX)) return null;
  const name = peerName.slice(MEET_KNOCK_NAME_PREFIX.length).trim();
  return name === "" ? "Guest" : name;
}

export function buildMeetControlMessage(payload: MeetControlMessage): string {
  return `${MEET_CONTROL_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * Server error codes from the channel-ACL join policy (chunk H,
 * `MeetSignalingService` / `MeetChannelJoinPolicy`): a direct join by a
 * non-member fails with `knock_required`; a knock join on a room with nobody
 * to admit fails with `room_not_active`. The signaling http-client surfaces
 * the code as the thrown Error message.
 */
const MEET_KNOCK_REQUIRED_ERROR = "knock_required";
const MEET_ROOM_NOT_ACTIVE_ERROR = "room_not_active";

export function isMeetKnockRequiredError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MEET_KNOCK_REQUIRED_ERROR);
}

export function isMeetRoomNotActiveError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MEET_ROOM_NOT_ACTIVE_ERROR);
}

export function parseMeetControlMessage(text: string): MeetControlMessage | null {
  if (!text.startsWith(MEET_CONTROL_PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(MEET_CONTROL_PREFIX.length)) as Record<string, unknown>;
    if (
      parsed.kind === "knock" &&
      typeof parsed.peerId === "string" &&
      typeof parsed.name === "string"
    ) {
      return { kind: "knock", peerId: parsed.peerId, name: parsed.name };
    }
    if ((parsed.kind === "admit" || parsed.kind === "deny") && typeof parsed.peerId === "string") {
      return { kind: parsed.kind, peerId: parsed.peerId };
    }
    if (parsed.kind === "end" && typeof parsed.by === "string") {
      return { kind: "end", by: parsed.by };
    }
    if (parsed.kind === "mute" && typeof parsed.peerId === "string" && parsed.peerId !== "") {
      return { kind: "mute", peerId: parsed.peerId };
    }
    if (
      parsed.kind === "media" &&
      typeof parsed.mic === "boolean" &&
      typeof parsed.camera === "boolean"
    ) {
      return {
        kind: "media",
        mic: parsed.mic,
        camera: parsed.camera,
        ...(typeof parsed.screen === "boolean" ? { screen: parsed.screen } : {}),
      };
    }
  } catch {
    return null;
  }
  return null;
}
