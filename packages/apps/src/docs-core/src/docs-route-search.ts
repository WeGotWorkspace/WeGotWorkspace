import { isRtcDebugEnabledFromQuery, parseRtcDebugFlag } from "@/lib/rtc/debug";

export type DocsRouteSearch = {
  file?: string;
  /** Number `1` so the serializer emits `rtcDebug=1`, not `rtcDebug="1"`. */
  rtcDebug?: 1;
};

export function parseDocsRouteSearch(search: Record<string, unknown>): DocsRouteSearch {
  const file = typeof search.file === "string" ? search.file : undefined;
  const rtcDebug = parseRtcDebugFlag(search.rtcDebug);
  return {
    ...(file !== undefined ? { file } : {}),
    ...(rtcDebug !== undefined ? { rtcDebug } : {}),
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

export function docsSearchFromApiPath(
  apiPath: string,
  current?: Pick<DocsRouteSearch, "rtcDebug">,
): DocsRouteSearch {
  const rtcDebug = current?.rtcDebug ?? rtcDebugFromLocation();
  return {
    file: apiPath.replace(/^\/+/, ""),
    ...(rtcDebug ? { rtcDebug } : {}),
  };
}

/** Docs editor URL for a drive API path (`/docs?file=…`). */
export function docsHrefFromApiPath(
  apiPath: string,
  current?: Pick<DocsRouteSearch, "rtcDebug">,
): string {
  const search = docsSearchFromApiPath(apiPath, current);
  const query = new URLSearchParams();
  if (search.file) query.set("file", search.file);
  if (search.rtcDebug) query.set("rtcDebug", "1");
  return `/docs${query.toString() ? `?${query.toString()}` : ""}`;
}
