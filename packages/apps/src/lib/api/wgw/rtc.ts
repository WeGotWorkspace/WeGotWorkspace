import { wgwApiBaseUrl, wgwReadJson } from "@/lib/api/wgw/http";
import { isRtcDebugEnabled, setRtcDebugEnabled } from "@/lib/rtc/debug";
import { rtcLog } from "@/lib/rtc/log";
import { applyRtcDebugOverrides } from "@/lib/rtc/force-relay";
import { resolveRoomId } from "@/lib/rtc/room-id";
import { DEFAULT_RTC_SETTINGS, type RtcSettings } from "@/lib/rtc/types";
import type { components } from "@wgw/openapi-types/openapi-types";

export type { RtcSettings };

export type RtcPublicSettings = {
  stunUrls: string;
  turnAvailable: boolean;
  forceRelay: boolean;
  debug: boolean;
};

export type RtcIceSettings = Omit<RtcSettings, "forceRelay">;

type RtcRoomConfiguration = components["schemas"]["RtcRoomConfiguration"];

/** Public half of the C2 signing key, as `RtcRoomConfiguration.collabTicket`. */
export type PublishedCollabTicket = NonNullable<RtcRoomConfiguration["collabTicket"]>;

/** `"server"` when the configuration endpoint answered, `"fallback"` when defaults were used. */
export type RtcSettingsSource = "server" | "fallback";

export type FetchedRtcSettings = RtcSettings & {
  collabTicket?: PublishedCollabTicket;
  source?: RtcSettingsSource;
};

type RtcSettingsCarrier = {
  rtc?: {
    stunUrls?: unknown;
    turnAvailable?: unknown;
    forceRelay?: unknown;
    debug?: unknown;
  };
  stunUrls?: unknown;
  turnAvailable?: unknown;
  forceRelay?: unknown;
  debug?: unknown;
};

export function parseRtcSettingsPayload(payload: RtcSettingsCarrier): RtcPublicSettings {
  // Shared platform ICE settings (`GET /rooms/{roomId}/configuration`). Relay
  // credentials are never part of this payload; they come from a relay request.
  const rtc = payload.rtc ?? payload;
  return {
    stunUrls: typeof rtc.stunUrls === "string" ? rtc.stunUrls : "",
    turnAvailable: rtc.turnAvailable === true,
    forceRelay: rtc.forceRelay === true,
    debug: rtc.debug === true,
  };
}

export function resolveRtcSettings(publicSettings: RtcPublicSettings): RtcSettings {
  return applyRtcDebugOverrides({
    ...DEFAULT_RTC_SETTINGS,
    stunUrls: publicSettings.stunUrls,
    turnAvailable: publicSettings.turnAvailable,
    forceRelay: publicSettings.forceRelay,
  });
}

export async function fetchRtcSettings(options?: {
  url?: string;
  bearerToken?: string;
  /** Guest auth for the meeting room configuration. Sent as a query parameter. */
  sessionKey?: string;
  channel?: "meet" | "collab";
  room?: string;
}): Promise<FetchedRtcSettings> {
  const channel = options?.channel ?? "meet";
  const base = wgwApiBaseUrl();
  const room = options?.room ?? (channel === "meet" ? "bootstrap" : "");
  const requestUrl =
    options?.url ??
    (room
      ? `${base}/rooms/${encodeURIComponent(resolveRoomId(channel, room))}/configuration`
      : `${base}/rooms/bootstrap/configuration`);
  const finalUrl = options?.sessionKey
    ? `${requestUrl}${requestUrl.includes("?") ? "&" : "?"}sessionKey=${encodeURIComponent(options.sessionKey)}`
    : requestUrl;
  rtcLog({ channel }, "rtc-settings-request", { requestUrl });
  const headers: Record<string, string> = {};
  if (options?.bearerToken) headers.Authorization = `Bearer ${options.bearerToken}`;

  const res = await fetch(finalUrl, { cache: "no-store", headers });
  if (!res.ok) {
    rtcLog({ channel }, "rtc-settings-response", {
      requestUrl,
      ok: false,
      status: res.status,
      authorized: Boolean(options?.bearerToken) || Boolean(options?.sessionKey),
    });
    return { ...resolveRtcSettings({ ...DEFAULT_RTC_SETTINGS, debug: false }), source: "fallback" };
  }
  try {
    const payload = (await wgwReadJson(res)) as RtcRoomConfiguration;
    const parsed = parseRtcSettingsPayload(payload);
    setRtcDebugEnabled(parsed.debug);
    const settings = resolveRtcSettings(parsed);
    rtcLog({ channel }, "rtc-settings-response", {
      requestUrl,
      ok: true,
      status: res.status,
      forceRelay: settings.forceRelay,
      turnAvailable: settings.turnAvailable,
    });
    const result: FetchedRtcSettings = { ...settings, source: "server" };
    return payload.collabTicket ? { ...result, collabTicket: payload.collabTicket } : result;
  } catch {
    rtcLog({ channel }, "rtc-settings-response", {
      requestUrl,
      ok: true,
      status: res.status,
      parseError: true,
    });
    return { ...resolveRtcSettings({ ...DEFAULT_RTC_SETTINGS, debug: false }), source: "fallback" };
  }
}

export function isRtcDebugEnabledForChannel(): boolean {
  return isRtcDebugEnabled();
}
