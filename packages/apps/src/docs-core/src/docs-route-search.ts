import { isRtcDebugEnabledFromQuery, parseRtcDebugFlag } from "@/lib/rtc/debug";
import { isRtcForceRelayEnabledFromQuery, parseRtcForceRelayFlag } from "@/lib/rtc/force-relay";

export type DocsRouteSearch = {
  file?: string;
  /** Number `1` so the serializer emits `rtcDebug=1`, not `rtcDebug="1"`. */
  rtcDebug?: 1;
  /** Number `1` so the serializer emits `rtcForceRelay=1`. Debug-only. */
  rtcForceRelay?: 1;
};

export function parseDocsRouteSearch(search: Record<string, unknown>): DocsRouteSearch {
  const file = typeof search.file === "string" ? search.file : undefined;
  const rtcDebug = parseRtcDebugFlag(search.rtcDebug);
  const rtcForceRelay = parseRtcForceRelayFlag(search.rtcForceRelay);
  return {
    ...(file !== undefined ? { file } : {}),
    ...(rtcDebug !== undefined ? { rtcDebug } : {}),
    ...(rtcForceRelay !== undefined ? { rtcForceRelay } : {}),
  };
}

export function validateDocsRouteSearch(search: Record<string, unknown>): DocsRouteSearch {
  return parseDocsRouteSearch(search);
}

/** Normalize a drive API path from the `file` search param (always leading `/`). */
export function docsApiPathFromSearch(file: string | undefined): string | null {
  const trimmed = file?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function rtcDebugFromLocation(): 1 | undefined {
  if (typeof window === "undefined") return undefined;
  return isRtcDebugEnabledFromQuery(window.location.search) ? 1 : undefined;
}

function rtcForceRelayFromLocation(): 1 | undefined {
  if (typeof window === "undefined") return undefined;
  return isRtcForceRelayEnabledFromQuery(window.location.search) ? 1 : undefined;
}

export function docsSearchFromApiPath(
  apiPath: string,
  current?: Pick<DocsRouteSearch, "rtcDebug" | "rtcForceRelay">,
): DocsRouteSearch {
  const rtcDebug = current?.rtcDebug ?? rtcDebugFromLocation();
  const rtcForceRelay = current?.rtcForceRelay ?? rtcForceRelayFromLocation();
  return {
    file: apiPath.replace(/^\/+/, ""),
    ...(rtcDebug ? { rtcDebug } : {}),
    ...(rtcForceRelay ? { rtcForceRelay } : {}),
  };
}

/** Docs editor URL for a drive API path (`/docs?file=…`). */
export function docsHrefFromApiPath(
  apiPath: string,
  current?: Pick<DocsRouteSearch, "rtcDebug" | "rtcForceRelay">,
): string {
  const search = docsSearchFromApiPath(apiPath, current);
  const query = new URLSearchParams();
  if (search.file) query.set("file", search.file);
  if (search.rtcDebug) query.set("rtcDebug", "1");
  if (search.rtcForceRelay) query.set("rtcForceRelay", "1");
  return `/docs${query.toString() ? `?${query.toString()}` : ""}`;
}
