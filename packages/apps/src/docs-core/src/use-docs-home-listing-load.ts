import { useCallback, useEffect, useRef, useState } from "react";
import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import {
  fetchAllDocsHomeListingPages,
  type DocsHomeBrowseParams,
  type DocsHomeFetcher,
} from "@/lib/files/docs-home-listing";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { guardOfflineCacheStep } from "@/lib/offline/core/offline-cache-guard";
import { syncDocsBodiesFromListingResults } from "@/lib/offline/docs/docs-body-sync";
import {
  docsListingCacheKey,
  type DocsListingBrowseFilters,
} from "@/lib/offline/docs/docs-listing-cache-key";
import {
  docsListingRowsDiffer,
  mergeLiveDocsListing,
  notifyDocsCachesChanged,
} from "@/lib/offline/docs/docs-inbound-sync";
import {
  readDocsListingFromCache,
  writeDocsListingToCache,
} from "@/lib/offline/docs/docs-listing-offline-store";
import {
  keepLiveNodeIds,
  useDocsListingCacheRefresh,
  useDocsListingReconnectRefresh,
} from "@/docs-core/src/use-docs-listing-cache-refresh";
import { retryFailedListing } from "@/docs-core/src/docs-listing-retry";

/** Keep rows a queued write still owns: the server has not seen that write yet. */
async function mergeWithQueuedWrites(
  username: string | null,
  filters: DocsListingBrowseFilters,
  live: { results: WgwUnifiedSearchResult[] },
  cacheTimeoutMs: number,
): Promise<WgwUnifiedSearchResult[]> {
  if (!username) return live.results;
  const merged = mergeLiveDocsListing(username, filters, live.results);
  return guardOfflineCacheStep(merged, live.results, cacheTimeoutMs);
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
  const failedReloadsRef = useRef(0);
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
      const sameView = shownKeyRef.current === filtersKey; // live rows keep their id (#1976)
      shownKeyRef.current = filtersKey;
      setResults((shown) => (sameView ? keepLiveNodeIds(shown, cached.results) : cached.results));
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
        const results = await mergeWithQueuedWrites(offlineUsername, filters, live, cacheTimeoutMs);
        if (signal.aborted) return false;
        shownKeyRef.current = filtersKey;
        setResults(results);
        setHasMore(live.hasMore);
        setIsOfflineListing(false);
        setError(null);
        const rowsChanged = offlineUsername
          ? await guardOfflineCacheStep(
              docsListingRowsDiffer(offlineUsername, filters, results),
              false,
              cacheTimeoutMs,
            )
          : false;
        await persistListingCache(results, live.hasMore);
        if (offlineUsername && rowsChanged) notifyDocsCachesChanged(offlineUsername);
        if (offlineUsername) {
          void syncDocsBodiesFromListingResults(offlineUsername, live.results, { signal });
        }
        return true;
      } catch (_err) {
        return false;
      }
    },
    [
      baseParams,
      cacheTimeoutMs,
      fetcher,
      filters,
      filtersKey,
      offlineUsername,
      persistListingCache,
      query,
    ],
  );

  const refreshUsername = enabled ? offlineUsername : null;
  useDocsListingCacheRefresh({
    username: refreshUsername,
    filters,
    shownKeyRef,
    cacheTimeoutMs,
    setResults,
    setHasMore,
  });

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

      retryFailedListing(failedReloadsRef, liveLoaded, setReloadToken, controller.signal);
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

  useDocsListingReconnectRefresh(refreshUsername, fetchLiveListing, setRefreshing);

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
