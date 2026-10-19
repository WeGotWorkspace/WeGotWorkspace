import { useCallback, useEffect, useRef, useState } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import type {
  WgwUnifiedSearchData,
  WgwUnifiedSearchParams,
  WgwUnifiedSearchResult,
} from "@/lib/api/wgw/search";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { guardOfflineCacheStep } from "@/lib/offline/core/offline-cache-guard";
import { syncDocsBodiesFromListingResults } from "@/lib/offline/docs/docs-body-sync";
import {
  docsListingCacheKey,
  type DocsListingBrowseFilters,
} from "@/lib/offline/docs/docs-listing-cache-key";
import {
  readDocsListingFromCache,
  writeDocsListingToCache,
} from "@/lib/offline/docs-listing-offline-store";

export type DocsHomeFetcher = (
  params: Omit<WgwUnifiedSearchParams, "signal"> & { signal?: AbortSignal },
) => Promise<WgwUnifiedSearchData>;

export type DocsHomeBrowseParams = Omit<WgwUnifiedSearchParams, "signal" | "q" | "offset"> & {
  limit: number;
};

/** Fetch every browse page so offline cache and UI match the full server listing. */
export async function fetchAllDocsHomeListingPages(
  fetcher: DocsHomeFetcher,
  baseParams: DocsHomeBrowseParams,
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

export type UseDocsHomeListingLoadOptions = {
  enabled: boolean;
  offlineUsername: string | null;
  filters: DocsListingBrowseFilters;
  baseParams: DocsHomeBrowseParams;
  query: string;
  fetcher: DocsHomeFetcher;
  cacheTimeoutMs: number;
};

/**
 * Cache-first browse listing for Docs home.
 *
 * Rows for the current filters (from the offline cache or an earlier fetch)
 * show at once and the live fetch refreshes them quietly (`refreshing`).
 * `loading` is only true while there is nothing to show yet.
 */
export function useDocsHomeListingLoad({
  enabled,
  offlineUsername,
  filters,
  baseParams,
  query,
  fetcher,
  cacheTimeoutMs,
}: UseDocsHomeListingLoadOptions) {
  const [results, setResults] = useState<WgwUnifiedSearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineListing, setIsOfflineListing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const resultsRef = useRef(results);
  resultsRef.current = results;
  /** Cache key of the filters the visible `results` belong to. */
  const shownKeyRef = useRef<string | null>(null);
  const filtersKey = docsListingCacheKey(filters);

  const persistListingCache = useCallback(
    async (nextResults: WgwUnifiedSearchResult[], nextHasMore: boolean) => {
      if (!offlineUsername) return;
      await guardOfflineCacheStep(
        writeDocsListingToCache(offlineUsername, filters, {
          results: nextResults,
          hasMore: nextHasMore,
        }),
        undefined,
        cacheTimeoutMs,
      );
    },
    [cacheTimeoutMs, filters, offlineUsername],
  );

  const applyCachedListing = useCallback(
    async (online: boolean): Promise<boolean> => {
      if (!offlineUsername) return false;
      const cached = await guardOfflineCacheStep(
        readDocsListingFromCache(offlineUsername, filters),
        null,
        cacheTimeoutMs,
      );
      if (!cached || cached.results.length === 0) return false;
      shownKeyRef.current = filtersKey;
      setResults(cached.results);
      setHasMore(cached.hasMore);
      setError(null);
      setIsOfflineListing(!online);
      return true;
    },
    [cacheTimeoutMs, filters, filtersKey, offlineUsername],
  );

  const fetchLiveListing = useCallback(
    async (signal: AbortSignal): Promise<boolean> => {
      if (!getConnectivitySnapshot()) return false;
      try {
        const live = await fetchAllDocsHomeListingPages(fetcher, baseParams, query, signal);
        if (signal.aborted) return false;
        shownKeyRef.current = filtersKey;
        setResults(live.results);
        setHasMore(live.hasMore);
        setIsOfflineListing(false);
        setError(null);
        await persistListingCache(live.results, live.hasMore);
        if (offlineUsername) {
          void syncDocsBodiesFromListingResults(offlineUsername, live.results, { signal });
        }
        return true;
      } catch (_err) {
        return false;
      }
    },
    [baseParams, fetcher, filtersKey, offlineUsername, persistListingCache, query],
  );

  useEffect(() => {
    if (!enabled) {
      shownKeyRef.current = null;
      setResults([]);
      setHasMore(false);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setError(null);
      setIsOfflineListing(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const hadRows = shownKeyRef.current === filtersKey && resultsRef.current.length > 0;
    if (!hadRows) {
      // Rows from other filters must not stand in for this listing.
      shownKeyRef.current = null;
      setResults((previous) => (previous.length === 0 ? previous : []));
      setHasMore(false);
      setRefreshing(false);
      setLoading(true);
    }

    void (async () => {
      setLoadingMore(false);
      setError(null);

      const online = getConnectivitySnapshot();
      const hadCache = await applyCachedListing(online);
      if (cancelled) return;
      const hasRows = hadCache || hadRows;

      if (!online) {
        if (!hasRows) {
          setResults([]);
          setHasMore(false);
        }
        setIsOfflineListing(true);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (hasRows) {
        setLoading(false);
        setRefreshing(true);
      } else {
        setIsOfflineListing(false);
      }

      const liveLoaded = await fetchLiveListing(controller.signal);
      if (cancelled) return;

      if (!liveLoaded) {
        if (hasRows) {
          setIsOfflineListing(true);
        } else {
          setError("Failed to load documents");
          setResults([]);
          setHasMore(false);
        }
      }
      setLoading(false);
      setRefreshing(false);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [applyCachedListing, enabled, fetchLiveListing, filtersKey, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useOnReconnect(
    useCallback(() => {
      if (!enabled || !offlineUsername) return;
      void (async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        if (!getConnectivitySnapshot()) return;
        const controller = new AbortController();
        setRefreshing(true);
        await fetchLiveListing(controller.signal);
        setRefreshing(false);
      })();
    }, [enabled, fetchLiveListing, offlineUsername]),
  );

  return {
    results,
    resultsRef,
    setResults,
    hasMore,
    setHasMore,
    loading,
    refreshing,
    loadingMore,
    setLoadingMore,
    error,
    setError,
    isOfflineListing,
    persistListingCache,
    reload,
  };
}
