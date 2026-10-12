import type { RtcSettings } from "@/lib/rtc/types";
import { readRtcTestOverrides } from "@/lib/rtc/test-overrides";

function matchesTruthy(value: string | null | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/** Debug-only: `VITE_WGW_RTC_FORCE_RELAY=1` in `.env.local` (Storybook / Vite dev). */
export function isRtcForceRelayEnabledFromEnv(): boolean {
  const raw = import.meta.env.VITE_WGW_RTC_FORCE_RELAY;
  if (typeof raw !== "string") return false;
  return matchesTruthy(raw);
}

export function isRtcForceRelayEnabled(): boolean {
  return isRtcForceRelayEnabledFromEnv() || readRtcTestOverrides().forceRelay;
}

/**
 * Apply debug overrides after loading ICE settings from the API.
 * A caller that already set `forceRelay` keeps it; the Vite env and test
 * override can turn it on when the mesh is built.
 */
export function applyRtcDebugOverrides(settings: RtcSettings): RtcSettings {
  return {
    ...settings,
    forceRelay: settings.forceRelay || isRtcForceRelayEnabled(),
  };
}
