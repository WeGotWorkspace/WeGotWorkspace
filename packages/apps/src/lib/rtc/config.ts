import type { IceMode, RtcSettings, TurnCredentials } from "@/lib/rtc/types";

export type ToRtcConfigOptions = {
  /** Pool size when not forcing relay (meet: 4, collab: 2). */
  iceCandidatePoolSize?: number;
  /** Credentials from a relay request; without them there is no TURN server. */
  turn?: TurnCredentials | null;
};

/**
 * Each url costs its own STUN binding or TURN allocation, and gathering waits
 * on all of them. A provider's full list (20+ urls) stalls gathering at zero
 * candidates, so only the first few of each kind are used.
 */
export const MAX_ICE_URLS_PER_KIND = 3;

function firstUnique(urls: readonly string[]): string[] {
  return [...new Set(urls)].slice(0, MAX_ICE_URLS_PER_KIND);
}

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
  const stunUrls = firstUnique(parseUrlList(settings.stunUrls, "stun"));
  const iceServers: RTCIceServer[] = [];
  const turnServer: RTCIceServer | null =
    turn && turnUrls.length > 0
      ? { urls: firstUnique(turnUrls), username: turn.username, credential: turn.credential }
      : null;

  if (forceRelay) {
    if (turnServer) {
      iceServers.push(turnServer);
    }
  } else {
    if (stunUrls.length > 0) {
      iceServers.push({ urls: stunUrls });
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
