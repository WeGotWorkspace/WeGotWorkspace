import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWgwUnifiedSearch, type WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  apiPathFromSearchSourceKey,
  driveFileFromSearchResult,
  driveLocationLabel,
} from "@/drive-core/src/drive-search-utils";
import { uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";
import {
  DOCS_HOME_CATEGORIES,
  DOCS_HOME_EXTENSIONS,
  DOCS_HOME_PAGE_SIZE,
  DOCS_HOME_SOURCES,
} from "@/docs-core/src/docs-home-constants";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { resolveDocsDriveLabel, type DocsHomeGroupRoot } from "@/docs-core/src/docs-home-drives";
import {
  useDocsHomeListingLoad,
  type DocsHomeFetcher,
} from "@/docs-core/src/use-docs-home-listing-load";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { OFFLINE_CACHE_TIMEOUT_MS } from "@/lib/offline/core/offline-cache-guard";
import type { DocsListingBrowseFilters } from "@/lib/offline/docs/docs-listing-cache-key";

export {
  fetchAllDocsHomeListingPages,
  type DocsHomeFetcher,
} from "@/docs-core/src/use-docs-home-listing-load";

export type UseDocsHomeListOptions = {
  /** Current user login/handle; used to map API source keys to UI paths. */
  username: string;
  /** Optional home search box value; debounced and resets pagination on change. */
  query?: string;
  /**
   * Optional storage-key prefix scoping the browse to a single drive
   * (e.g. `users/alice` for My Drive, `groups/team` for a shared drive).
   * Changing it resets pagination and reloads from offset 0.
   */
  pathPrefix?: string;
  /** Injectable fetcher (mock in Storybook/Vitest); defaults to the live client. */
  fetcher?: DocsHomeFetcher;
  pageSize?: number;
  debounceMs?: number;
  /** When set, enables Dexie cache read/write for offline home browse. */
  offlineUsername?: string | null;
  /** When false, skips browse fetches (e.g. Docs home Shared with me view). */
  enabled?: boolean;
  /**
   * Discovered group drive roots (slug + display label). Used to map location
   * chips to Docs SST labels (e.g. "Administrators" instead of "administrators").
   */
  groupRoots?: readonly DocsHomeGroupRoot[];
  /** Max wait for one offline cache read/write before loading continues without it. */
  cacheTimeoutMs?: number;
};

export type UseDocsHomeListResult = {
  files: DriveFile[];
  /** Nothing to show yet for the current filters while the first fetch runs. */
  loading: boolean;
  /** Rows are visible while a live fetch refreshes them in the background. */
  refreshing: boolean;
  /** A `loadMore()` page request is in flight. */
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  /** True when the visible list is served from the offline cache (no live fetch). */
  isOfflineListing: boolean;
};

/** Sort raw browse results newest-first (client-side safety net over server order). */
export function sortDocsHomeResults(
  results: readonly WgwUnifiedSearchResult[],
): WgwUnifiedSearchResult[] {
  return [...results].sort((a, b) => {
    const am = a.modifiedAt ?? 0;
    const bm = b.modifiedAt ?? 0;
    if (bm !== am) return bm - am;
    return b.id - a.id;
  });
}

/** Inbound Shared-with-me location strings from Drive (keep as-is; not Docs drive SST). */
function isInboundSharedDriveLocation(location: string): boolean {
  if (location === driveLabels.sidebarSharedWithMe) return true;
  return location.startsWith(driveLabels.sharedBy(""));
}

/** Map browse results to `DriveFile`s (deduped by source key, modified-desc). */
export function mapDocsHomeResults(
  results: readonly WgwUnifiedSearchResult[],
  username: string,
  options?: {
    personalDriveLabel?: string;
    groupRoots?: readonly DocsHomeGroupRoot[];
  },
): DriveFile[] {
  const personalDriveLabel = options?.personalDriveLabel ?? docsLabels.homeMyDrive;
  const groupRoots = options?.groupRoots;
  const seen = new Set<string>();
  const files: DriveFile[] = [];
  for (const result of sortDocsHomeResults(results)) {
    const apiPath = apiPathFromSearchSourceKey(result.sourceKey);
    if (!apiPath || seen.has(result.sourceKey)) continue;
    seen.add(result.sourceKey);
    const uiPath = uiPathFromApiPath(apiPath, username);
    const file = driveFileFromSearchResult(result, uiPath, apiPath, username);
    const driveLoc = driveLocationLabel(result.sourceKey, username);
    if (!driveLoc) {
      files.push(file);
      continue;
    }
    // Shared-by / Shared with me keep Drive inbound wording + Share icon path.
    if (isInboundSharedDriveLocation(driveLoc)) {
      files.push({ ...file, location: driveLoc });
      continue;
    }
    // Personal + group drives: Docs SST labels via resolveDocsDriveLabel
    // (Personal / Administrators), not Drive "My Drive" / raw slug.
    files.push({
      ...file,
      location: resolveDocsDriveLabel(result.sourceKey, {
        personalDriveLabel,
        groupRoots,
      }),
    });
  }
  return files;
}

function browseFilters(scopePrefix: string, debouncedQuery: string): DocsListingBrowseFilters {
  return {
    pathPrefix: scopePrefix || undefined,
    query: debouncedQuery || undefined,
    sources: DOCS_HOME_SOURCES,
    extensions: DOCS_HOME_EXTENSIONS,
    categories: DOCS_HOME_CATEGORIES,
  };
}

export function useDocsHomeList({
  username,
  query = "",
  pathPrefix,
  fetcher = fetchWgwUnifiedSearch,
  pageSize = DOCS_HOME_PAGE_SIZE,
  debounceMs = 300,
  offlineUsername = null,
  enabled = true,
  groupRoots,
  cacheTimeoutMs = OFFLINE_CACHE_TIMEOUT_MS,
}: UseDocsHomeListOptions): UseDocsHomeListResult {
  const [debouncedQuery, setDebouncedQuery] = useState(() => query.trim());

  useEffect(() => {
    const trimmed = query.trim();
    const timer = window.setTimeout(() => setDebouncedQuery(trimmed), debounceMs);
    return () => window.clearTimeout(timer);
  }, [query, debounceMs]);

  const scopePrefix = pathPrefix?.trim() ?? "";
  const filters = useMemo(
    () => browseFilters(scopePrefix, debouncedQuery),
    [scopePrefix, debouncedQuery],
  );

  const baseParams = useMemo(
    () => ({
      sources: [...DOCS_HOME_SOURCES],
      extensions: [...DOCS_HOME_EXTENSIONS],
      categories: [...DOCS_HOME_CATEGORIES],
      limit: pageSize,
      ...(scopePrefix ? { pathPrefix: scopePrefix } : {}),
    }),
    [pageSize, scopePrefix],
  );

  const listing = useDocsHomeListingLoad({
    enabled,
    offlineUsername,
    filters,
    baseParams,
    query: debouncedQuery,
    fetcher,
    cacheTimeoutMs,
  });
  const {
    results,
    resultsRef,
    setResults,
    hasMore,
    setHasMore,
    loading,
    loadingMore,
    setLoadingMore,
    setError,
    isOfflineListing,
    persistListingCache,
  } = listing;

  const loadMore = useCallback(() => {
    if (!enabled || loading || loadingMore || !hasMore || isOfflineListing) return;
    const controller = new AbortController();
    setLoadingMore(true);
    void (async () => {
      try {
        const data = await fetcher({
          ...baseParams,
          q: debouncedQuery || undefined,
          offset: resultsRef.current.length,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const merged = [...resultsRef.current, ...(data.results ?? [])];
        setResults(merged);
        setHasMore(Boolean(data.hasMore));
        await persistListingCache(merged, Boolean(data.hasMore));
      } catch (_err) {
        if (controller.signal.aborted) return;
        setError(_err instanceof Error ? _err.message : "Failed to load documents");
      } finally {
        if (!controller.signal.aborted) setLoadingMore(false);
      }
    })();
  }, [
    baseParams,
    debouncedQuery,
    enabled,
    fetcher,
    hasMore,
    isOfflineListing,
    loading,
    loadingMore,
    persistListingCache,
    resultsRef,
    setError,
    setHasMore,
    setLoadingMore,
    setResults,
  ]);

  // Content key so an unstable `groupRoots` array identity does not remap files
  // every render (which would feed Docs home's mergeGroupRoots effect loop).
  const groupRootsKey = groupRoots?.map((root) => `${root.slug}\0${root.label}`).join("\n") ?? "";

  const files = useMemo(
    () =>
      mapDocsHomeResults(results, username, {
        personalDriveLabel: docsLabels.homeMyDrive,
        groupRoots,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- groupRootsKey tracks slug/label content
    [results, username, groupRootsKey],
  );

  return {
    files,
    loading,
    refreshing: listing.refreshing,
    loadingMore,
    error: listing.error,
    hasMore,
    loadMore,
    reload: listing.reload,
    isOfflineListing,
  };
}
