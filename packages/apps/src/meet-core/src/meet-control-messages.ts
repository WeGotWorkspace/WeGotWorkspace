export type MeetControlMessage =
  | { kind: "knock"; peerId: string; name: string }
  | { kind: "admit"; peerId: string }
  | { kind: "deny"; peerId: string }
  | { kind: "end"; by: string }
  | { kind: "mute"; peerId: string }
  | { kind: "unmute"; peerId: string }
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

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Inbound control frames arrive as prefixed chat JSON. `JSON.parse` is `any`;
 * this narrows to `MeetControlMessage` or `null` without assertions.
 */
export function parseMeetControlMessage(text: string): MeetControlMessage | null {
  if (!text.startsWith(MEET_CONTROL_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(MEET_CONTROL_PREFIX.length));
  } catch {
    return null;
  }
  if (!isJsonRecord(parsed)) return null;
  const kind = parsed.kind;
  if (typeof kind !== "string") return null;

  switch (kind) {
    case "knock": {
      const peerId = readString(parsed.peerId);
      const name = readString(parsed.name);
      return peerId !== null && name !== null ? { kind: "knock", peerId, name } : null;
    }
    case "admit":
    case "deny": {
      const peerId = readString(parsed.peerId);
      return peerId !== null ? { kind, peerId } : null;
    }
    case "end": {
      const by = readString(parsed.by);
      return by !== null ? { kind: "end", by } : null;
    }
    case "mute":
    case "unmute": {
      const peerId = readString(parsed.peerId);
      return peerId !== null && peerId !== "" ? { kind, peerId } : null;
    }
    case "media": {
      const mic = readBoolean(parsed.mic);
      const camera = readBoolean(parsed.camera);
      if (mic === null || camera === null) return null;
      const screen = readBoolean(parsed.screen);
      if (screen === null) return { kind: "media", mic, camera };
      return { kind: "media", mic, camera, screen };
    }
    default:
      return null;
  }
}
