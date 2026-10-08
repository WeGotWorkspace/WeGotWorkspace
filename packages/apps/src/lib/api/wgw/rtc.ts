import { wgwApiBaseUrl, wgwReadJson } from "@/lib/api/wgw/http";
import { isRtcDebugEnabled } from "@/lib/rtc/debug";
import { rtcLog } from "@/lib/rtc/log";
import { applyRtcDebugOverrides } from "@/lib/rtc/force-relay";
import { resolveRoomId } from "@/lib/rtc/room-id";
import { DEFAULT_RTC_SETTINGS, type RtcSettings } from "@/lib/rtc/types";
import type { components } from "@wgw/openapi-types/openapi-types";

export type { RtcSettings };

export type RtcIceSettings = Omit<RtcSettings, "forceRelay">;

type RtcRoomConfiguration = components["schemas"]["RtcRoomConfiguration"];

/** Public half of the C2 signing key, as `RtcRoomConfiguration.collabTicket`. */
export type PublishedCollabTicket = NonNullable<RtcRoomConfiguration["collabTicket"]>;

export type FetchedRtcSettings = RtcSettings & {
  collabTicket?: PublishedCollabTicket;
};

type RtcSettingsCarrier = {
  rtc?: { stunUrls?: unknown; turnAvailable?: unknown };
  stunUrls?: unknown;
  turnAvailable?: unknown;
};

export function parseRtcSettingsPayload(payload: RtcSettingsCarrier): RtcIceSettings {
  // Shared platform ICE settings (`GET /rooms/{roomId}/configuration`). Relay
  // credentials are never part of this payload; they come from a relay request.
  const rtc = payload.rtc ?? payload;
  return {
    stunUrls: typeof rtc.stunUrls === "string" ? rtc.stunUrls : "",
    turnAvailable: rtc.turnAvailable === true,
  };
}

export function resolveRtcSettings(ice: RtcIceSettings): RtcSettings {
  return applyRtcDebugOverrides({ ...DEFAULT_RTC_SETTINGS, ...ice, forceRelay: false });
}

export async function fetchRtcSettings(options?: {
  url?: string;
  bearerToken?: string;
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
  rtcLog({ channel }, "rtc-settings-request", { requestUrl });
  const headers: Record<string, string> = {};
  if (options?.bearerToken) headers.Authorization = `Bearer ${options.bearerToken}`;

  const res = await fetch(requestUrl, { cache: "no-store", headers });
  if (!res.ok) {
    rtcLog({ channel }, "rtc-settings-response", { requestUrl, ok: false, status: res.status });
    return resolveRtcSettings(DEFAULT_RTC_SETTINGS);
  }
  try {
    const payload = (await wgwReadJson(res)) as RtcRoomConfiguration;
    const settings = resolveRtcSettings(parseRtcSettingsPayload(payload));
    rtcLog({ channel }, "rtc-settings-response", {
      requestUrl,
      ok: true,
      status: res.status,
      forceRelay: settings.forceRelay,
      turnAvailable: settings.turnAvailable,
    });
    return payload.collabTicket ? { ...settings, collabTicket: payload.collabTicket } : settings;
  } catch {
    rtcLog({ channel }, "rtc-settings-response", {
      requestUrl,
      ok: true,
      status: res.status,
      parseError: true,
    });
    return resolveRtcSettings(DEFAULT_RTC_SETTINGS);
  }
}

export function isRtcDebugEnabledForChannel(): boolean {
  return isRtcDebugEnabled();
}
