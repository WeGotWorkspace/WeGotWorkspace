import type { RtcSettings } from "@/lib/rtc/types";

const RTC_FORCE_RELAY_QUERY_PARAM = "rtcForceRelay";

function matchesTruthy(value: string | null | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/** Debug-only: `?rtcForceRelay=1` on the page URL. `public` and `iceTransportPolicy` are not this flag. */
export function isRtcForceRelayEnabledFromQuery(search: string): boolean {
  return matchesTruthy(new URLSearchParams(search).get(RTC_FORCE_RELAY_QUERY_PARAM));
}

/**
 * Router search value. Must be the number `1` so TanStack emits `rtcForceRelay=1`
 * instead of a quoted string, and so validation does not drop the flag.
 */
export function parseRtcForceRelayFlag(value: unknown): 1 | undefined {
  if (value === 1 || value === true) return 1;
  if (typeof value === "string" && matchesTruthy(value)) return 1;
  return undefined;
}

/** Debug-only: `VITE_WGW_RTC_FORCE_RELAY=1` in `.env.local` (Storybook / Vite dev). */
export function isRtcForceRelayEnabledFromEnv(): boolean {
  const raw = import.meta.env.VITE_WGW_RTC_FORCE_RELAY;
  if (typeof raw !== "string") return false;
  return matchesTruthy(raw);
}

export function isRtcForceRelayEnabled(): boolean {
  if (typeof window !== "undefined") {
    try {
      if (isRtcForceRelayEnabledFromQuery(window.location.search)) return true;
    } catch {
      // Ignore invalid location in non-browser test environments.
    }
  }
  return isRtcForceRelayEnabledFromEnv();
}

/**
 * Apply dev/debug overrides after loading ICE settings from the API.
 * A caller that already set `forceRelay` keeps it; the page query and Vite env
 * can turn it on later, when the mesh is built, if bootstrap ran too early.
 */
export function applyRtcDebugOverrides(settings: RtcSettings): RtcSettings {
  return {
    ...settings,
    forceRelay: settings.forceRelay || isRtcForceRelayEnabled(),
  };
}
