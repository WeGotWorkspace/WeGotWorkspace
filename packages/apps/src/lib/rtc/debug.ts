const RTC_DEBUG_QUERY_PARAM = "rtcDebug";
const LEGACY_RTC_DEBUG_QUERY_PARAMS = ["meetRtcDebug", "collabRtcDebug", "debugRtc"] as const;

function matchesTruthy(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const normalized = value.replace(/^"+|"+$/g, "").toLowerCase();
  return normalized === "" || normalized === "1" || normalized === "true";
}

export function isRtcDebugEnabledFromQuery(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  if (params.has(RTC_DEBUG_QUERY_PARAM) && matchesTruthy(params.get(RTC_DEBUG_QUERY_PARAM))) {
    return true;
  }

  return LEGACY_RTC_DEBUG_QUERY_PARAMS.some(
    (key) => params.has(key) && matchesTruthy(params.get(key)),
  );
}

/**
 * Router search value. Must be the number `1` (not the string `"1"`) so TanStack's
 * JSON search serializer emits `rtcDebug=1` instead of `rtcDebug="1"`.
 */
export function parseRtcDebugFlag(value: unknown): 1 | undefined {
  if (value === 1 || value === true) return 1;
  if (typeof value === "string" && matchesTruthy(value)) return 1;
  return undefined;
}

/**
 * Opt-in RTC handshake logs. Reads `?rtcDebug=1` (and legacy aliases) from
 * `window.location.search`. No localStorage. Callers already no-op when false.
 */
export function isRtcDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return isRtcDebugEnabledFromQuery(window.location.search);
  } catch {
    return false;
  }
}
