/**
 * Per-browser overrides for automated tests. E2E sets the global with
 * `context.addInitScript`; nothing in the app writes it.
 */
export type RtcTestOverrides = { debug: boolean; forceRelay: boolean };

export function readRtcTestOverrides(): RtcTestOverrides {
  if (typeof window === "undefined") return { debug: false, forceRelay: false };
  const value = (window as Window & { __WGW_RTC_TEST_OVERRIDES__?: unknown })
    .__WGW_RTC_TEST_OVERRIDES__;
  if (!value || typeof value !== "object") return { debug: false, forceRelay: false };
  const row = value as Record<string, unknown>;
  return { debug: row.debug === true, forceRelay: row.forceRelay === true };
}
