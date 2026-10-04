/**
 * Negotiated Meet chat channel. Both sides open it when the peer connection
 * is created. Id 2 is reserved for a future unreliable channel and is not opened.
 */

export const MEET_DATA_CHANNEL_LABEL = "meet";
export const MEET_DATA_CHANNEL_ID = 1;
export const MEET_UNRELIABLE_DATA_CHANNEL_ID = 2;

export const MEET_DATA_CHANNEL_INIT: RTCDataChannelInit = {
  negotiated: true,
  id: MEET_DATA_CHANNEL_ID,
  ordered: true,
};

/** Reserved for larger calls (#580). They are ignored, not handled. */
const IGNORED_MEET_DC_TYPES = new Set(["vad", "caps", "rank", "sig"]);

/** Same alphabet the room echo accepts, so the channel ULID fits either path. */
const MEET_DC_CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type MeetDcChat = {
  id: string;
  text: string;
  ts: number;
};

export function meetDcChatFrame(message: MeetDcChat): {
  t: "chat";
  id: string;
  text: string;
  ts: number;
} {
  return { t: "chat", id: message.id, text: message.text, ts: message.ts };
}

/**
 * Parse one data-channel payload. The sender is the connection the bytes
 * arrived on — a `from` or `name` field in the JSON is never returned.
 * Unknown types, including `vad`, `caps`, `rank`, and `sig`, are ignored.
 */
export function parseMeetDcMessage(raw: string): MeetDcChat | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.t !== "string") return null;
  if (IGNORED_MEET_DC_TYPES.has(record.t) || record.t !== "chat") return null;
  if (typeof record.id !== "string" || !MEET_DC_CLIENT_ID.test(record.id)) return null;
  if (typeof record.text !== "string") return null;
  if (typeof record.ts !== "number" || !Number.isFinite(record.ts)) return null;
  return { id: record.id, text: record.text, ts: record.ts };
}

/** Both the offerer and the answerer call this while the peer connection is built. */
export function openMeetDataChannel(
  pc: RTCPeerConnection,
  onText: (data: string) => void,
): RTCDataChannel {
  const channel = pc.createDataChannel(MEET_DATA_CHANNEL_LABEL, MEET_DATA_CHANNEL_INIT);
  channel.binaryType = "arraybuffer";
  channel.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    onText(event.data);
  };
  return channel;
}
