import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import {
  fetchWgwUnifiedSearch,
  type WgwUnifiedSearchData,
  type WgwUnifiedSearchParams,
  type WgwUnifiedSearchResult,
} from "@/lib/api/wgw/search";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  apiPathFromSearchSourceKey,
  driveFileFromSearchResult,
} from "@/drive-core/src/drive-search-utils";
import { uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";
import {
  DOCS_HOME_CATEGORIES,
  DOCS_HOME_EXTENSIONS,
  DOCS_HOME_PAGE_SIZE,
  DOCS_HOME_SOURCES,
} from "@/docs-core/src/docs-home-constants";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { syncDocsBodiesFromListingResults } from "@/lib/offline/docs/docs-body-sync";
import type { DocsListingBrowseFilters } from "@/lib/offline/docs/docs-listing-cache-key";
import {
  readDocsListingFromCache,
  writeDocsListingToCache,
} from "@/lib/offline/docs-listing-offline-store";

export type DocsHomeFetcher = (
  params: Omit<WgwUnifiedSearchParams, "signal"> & { signal?: AbortSignal },
) => Promise<WgwUnifiedSearchData>;

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
};

export type UseDocsHomeListResult = {
  files: DriveFile[];
  /** Initial load or query-change reload in flight. */
  loading: boolean;
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

/** Map browse results to `DriveFile`s (deduped by source key, modified-desc). */
export function mapDocsHomeResults(
  results: readonly WgwUnifiedSearchResult[],
  username: string,
): DriveFile[] {
  const seen = new Set<string>();
  const files: DriveFile[] = [];
  for (const result of sortDocsHomeResults(results)) {
    const apiPath = apiPathFromSearchSourceKey(result.sourceKey);
    if (!apiPath || seen.has(result.sourceKey)) continue;
    seen.add(result.sourceKey);
    const uiPath = uiPathFromApiPath(apiPath, username);
    files.push(driveFileFromSearchResult(result, uiPath, apiPath, username));
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

/** Fetch every browse page so offline cache and UI match the full server listing. */
export async function fetchAllDocsHomeListingPages(
  fetcher: DocsHomeFetcher,
  baseParams: Omit<WgwUnifiedSearchParams, "signal" | "q" | "offset"> & { limit: number },
  query: string,
  signal: AbortSignal,
): Promise<{ results: WgwUnifiedSearchResult[]; hasMore: boolean }> {
  const merged: WgwUnifiedSearchResult[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await fetcher({
      ...baseParams,
      q: query || undefined,
      offset,
      signal,
    });
    if (signal.aborted) {
      return { results: merged, hasMore: merged.length > 0 ? hasMore : false };
    }
    const page = data.results ?? [];
    merged.push(...page);
    hasMore = Boolean(data.hasMore);
    offset = merged.length;
    if (page.length === 0) {
      hasMore = false;
      break;
    }
  }

  return { results: merged, hasMore: false };
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
}: UseDocsHomeListOptions): UseDocsHomeListResult {
  const [results, setResults] = useState<WgwUnifiedSearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState(() => query.trim());
  const [isOfflineListing, setIsOfflineListing] = useState(false);
  const resultsRef = useRef(results);
  resultsRef.current = results;

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

  const persistListingCache = useCallback(
    async (nextResults: WgwUnifiedSearchResult[], nextHasMore: boolean) => {
      if (!offlineUsername) return;
      await writeDocsListingToCache(offlineUsername, filters, {
        results: nextResults,
        hasMore: nextHasMore,
      });
    },
    [filters, offlineUsername],
  );

  const applyCachedListing = useCallback(
    async (online: boolean): Promise<boolean> => {
      if (!offlineUsername) return false;
      const cached = await readDocsListingFromCache(offlineUsername, filters);
      if (!cached || cached.results.length === 0) return false;
      setResults(cached.results);
      setHasMore(cached.hasMore);
      setError(null);
      setIsOfflineListing(!online);
      return true;
    },
    [filters, offlineUsername],
  );

  const fetchLiveListing = useCallback(
    async (signal: AbortSignal): Promise<boolean> => {
      if (!getConnectivitySnapshot()) return false;
      try {
        const { results: nextResults, hasMore: nextHasMore } = await fetchAllDocsHomeListingPages(
          fetcher,
          baseParams,
          debouncedQuery,
          signal,
        );
        if (signal.aborted) return false;
        setResults(nextResults);
        setHasMore(nextHasMore);
        setIsOfflineListing(false);
        setError(null);
        await persistListingCache(nextResults, nextHasMore);
        if (offlineUsername) {
          void syncDocsBodiesFromListingResults(offlineUsername, nextResults, { signal });
        }
        return true;
      } catch (_err) {
        if (signal.aborted) return false;
        return false;
      }
    },
    [baseParams, debouncedQuery, fetcher, offlineUsername, persistListingCache],
  );

  useEffect(() => {
    if (!enabled) {
      setResults([]);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      setIsOfflineListing(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      setLoadingMore(false);
      setError(null);

      const online = getConnectivitySnapshot();
      const hadCache = await applyCachedListing(online);
      if (cancelled) return;

      if (!online) {
        if (!hadCache) {
          setResults([]);
          setHasMore(false);
          setError(null);
          setIsOfflineListing(true);
        }
        setLoading(false);
        return;
      }

      if (!hadCache) {
        setLoading(true);
        setIsOfflineListing(false);
      }

      const liveLoaded = await fetchLiveListing(controller.signal);
      if (controller.signal.aborted || cancelled) return;

      if (!liveLoaded) {
        if (hadCache) {
          setError(null);
          setIsOfflineListing(true);
        } else {
          setError("Failed to load documents");
          setResults([]);
          setHasMore(false);
        }
      }

      if (!controller.signal.aborted && !cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [applyCachedListing, enabled, fetchLiveListing, reloadToken]);

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
  ]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useOnReconnect(
    useCallback(() => {
      if (!enabled || !offlineUsername) return;
      void (async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        if (!getConnectivitySnapshot()) return;
        const controller = new AbortController();
        await fetchLiveListing(controller.signal);
      })();
    }, [enabled, fetchLiveListing, offlineUsername]),
  );

  const files = useMemo(() => mapDocsHomeResults(results, username), [results, username]);

  return {
    files,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    reload,
    isOfflineListing,
  };
}
