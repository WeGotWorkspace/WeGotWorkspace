import type { IceMode, RtcSettings, TurnCredentials } from "@/lib/rtc/types";

export type ToRtcConfigOptions = {
  /** Pool size when not forcing relay (meet: 4, collab: 2). */
  iceCandidatePoolSize?: number;
  /** Credentials from a relay request; without them there is no TURN server. */
  turn?: TurnCredentials | null;
};

export function normalizeIceUrl(raw: string, defaultScheme: "stun" | "turn"): string {
  const value = raw.trim();
  if (value === "") return "";
  if (/^(stun|stuns|turn|turns):/i.test(value)) return value;
  return `${defaultScheme}:${value}`;
}

export function parseUrlList(raw: string, defaultScheme: "stun" | "turn"): string[] {
  return raw
    .split(/[\n,\r]+/)
    .map((value) => normalizeIceUrl(value, defaultScheme))
    .filter((value) => value !== "");
}

export function stunUrlCount(settings: RtcSettings): number {
  return parseUrlList(settings.stunUrls, "stun").length;
}

export function toRtcConfig(
  settings: RtcSettings,
  mode: IceMode,
  options: ToRtcConfigOptions = {},
): RTCConfiguration {
  const turn = options.turn ?? null;
  const turnUrls = turn
    ? turn.urls.map((url) => normalizeIceUrl(url, "turn")).filter((url) => url !== "")
    : [];
  // Relay-only transport is pointless without credentials to reach the relay.
  const forceRelay = (settings.forceRelay || mode === "relay") && turnUrls.length > 0;
  const stunUrls = parseUrlList(settings.stunUrls, "stun");
  const iceServers: RTCIceServer[] = [];
  const turnServer: RTCIceServer | null =
    turn && turnUrls.length > 0
      ? { urls: [...new Set(turnUrls)], username: turn.username, credential: turn.credential }
      : null;

  if (forceRelay) {
    if (turnServer) {
      iceServers.push(turnServer);
    }
  } else {
    if (stunUrls.length > 0) {
      iceServers.push({ urls: [...new Set(stunUrls)] });
    }
    if (turnServer) {
      iceServers.push(turnServer);
    }
  }

  const poolSize = options.iceCandidatePoolSize ?? 4;

  return {
    iceServers,
    iceTransportPolicy: forceRelay ? "relay" : "all",
    iceCandidatePoolSize: forceRelay ? 0 : poolSize,
  };
}
