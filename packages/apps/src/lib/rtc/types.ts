export type SignalingChannel = "meet" | "collab" | "principal" | "chat" | "sheet" | "slides";

/** REST collection segment for room session signaling (`/rooms/{roomId}/*`). */
export function signalingApiSegment(_channel: SignalingChannel): string {
  return "rooms";
}

export type IceMode = "direct" | "relay";

/**
 * Wire capabilities a peer advertises at join (contract C8); must stay a subset
 * of `RtcPeerCaps::KNOWN` on the server, which drops anything it does not know.
 */
export type RtcPeerCap =
  "bin" | "ice-batch" | "ticket" | "meet-dc" | "yjs-http" | "relay-jit" | "since-ack";

export type RtcSettings = {
  stunUrls: string;
  /** Whether a relay is configured. The server never ships its credentials. */
  turnAvailable: boolean;
  forceRelay: boolean;
};

export const DEFAULT_RTC_SETTINGS: RtcSettings = {
  stunUrls: "",
  turnAvailable: false,
  forceRelay: false,
};

/**
 * Short-lived relay credentials, minted per actor by `POST /rooms/{id}/relay`.
 * They expire after `ttl` seconds, so they are never cached beyond a session.
 */
export type TurnCredentials = {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
};

export type RtcSignalType = "offer" | "answer" | "ice" | "bye" | "chat" | string;

export type RtcSignalMessage = {
  id?: number;
  from: string;
  to?: string;
  type: RtcSignalType;
  payload: unknown;
};

export type RtcPeerDescriptor = {
  id: string;
  name: string;
  /** Sabre username of the peer's owner — collab and principal rooms (server-derived). */
  user?: string;
};

export type RtcLinkState = "connected" | "connecting" | "failed" | "disconnected" | "closed";

export type RtcPollIntervals = {
  connectingMs: number;
  steadyMs: number;
};

export const DEFAULT_RTC_POLL_INTERVALS: RtcPollIntervals = {
  connectingMs: 400,
  steadyMs: 1200,
};

/** Meet fast steady cadence; backs off further when topology is stable (see `RtcPeerMesh`). */
export const MEET_RTC_POLL_INTERVALS: RtcPollIntervals = {
  connectingMs: 400,
  steadyMs: 1200,
};

/** @deprecated Use `DEFAULT_RTC_POLL_INTERVALS` — all channels share the same poll cadence. */
export const COLLAB_RTC_POLL_INTERVALS: RtcPollIntervals = DEFAULT_RTC_POLL_INTERVALS;

export const RTC_SIGNAL_ORDER: Record<string, number> = {
  offer: 0,
  answer: 1,
  ice: 2,
  bye: 3,
  chat: 4,
};

export function sortRtcSignalMessages<T extends { from: string; type: string }>(
  messages: T[],
): T[] {
  return [...messages].sort((a, b) => {
    const aRank = RTC_SIGNAL_ORDER[a.type] ?? 99;
    const bRank = RTC_SIGNAL_ORDER[b.type] ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    return a.from.localeCompare(b.from);
  });
}
