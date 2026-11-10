import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { guardOfflineCacheStep } from "@/lib/offline/core/offline-cache-guard";
import { subscribeDocsCachesChanged } from "@/lib/offline/docs/docs-inbound-sync";
import {
  docsListingCacheKey,
  type DocsListingBrowseFilters,
} from "@/lib/offline/docs/docs-listing-cache-key";
import { readDocsListingFromCache } from "@/lib/offline/docs-listing-offline-store";

export type UseDocsListingCacheRefreshOptions = {
  /** Offline account; null turns the refresh off. */
  username: string | null;
  filters: DocsListingBrowseFilters;
  /** Cache key of the filters the visible rows belong to. */
  shownKeyRef: RefObject<string | null>;
  cacheTimeoutMs: number;
  setResults: Dispatch<SetStateAction<WgwUnifiedSearchResult[]>>;
  setHasMore: (hasMore: boolean) => void;
};

/**
 * Cached rows carry no FileNode id (#1976). A row on screen from a live
 * response keeps its id while the cache still shows the same file: same path
 * and same modified time. Otherwise the row opens by path, which asks the server.
 */
export function keepLiveNodeIds(
  shown: readonly WgwUnifiedSearchResult[],
  cached: WgwUnifiedSearchResult[],
): WgwUnifiedSearchResult[] {
  const live = new Map(
    shown.filter((row) => row.nodeId).map((row) => [row.sourceKey, row] as const),
  );
  if (live.size === 0) return cached;
  return cached.map((row) => {
    const match = live.get(row.sourceKey);
    return match?.nodeId && match.modifiedAt === row.modifiedAt
      ? { ...row, nodeId: match.nodeId }
      : row;
  });
}

/**
 * Inbound sync in any tab changed the cached Docs views (#1563): show the
 * visible view as cached now, without a reload or a server request. A view
 * that is not on screen yet reads the cache when it opens.
 */
export function useDocsListingCacheRefresh({
  username,
  filters,
  shownKeyRef,
  cacheTimeoutMs,
  setResults,
  setHasMore,
}: UseDocsListingCacheRefreshOptions): void {
  const filtersKey = docsListingCacheKey(filters);

  useEffect(() => {
    if (!username) return undefined;
    return subscribeDocsCachesChanged(username, () => {
      if (shownKeyRef.current !== filtersKey) return;
      const read = readDocsListingFromCache(username, filters);
      void guardOfflineCacheStep(read, undefined, cacheTimeoutMs).then((cached) => {
        // A timeout or a view never cached is no reason to clear the list.
        if (!cached || shownKeyRef.current !== filtersKey) return;
        setResults((shown) => keepLiveNodeIds(shown, cached.results));
        setHasMore(cached.hasMore);
      });
    });
    // `filtersKey` stands for `filters`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheTimeoutMs, filtersKey, setHasMore, setResults, shownKeyRef, username]);
}

/**
 * Back online: fetch the visible view again once the connection settles. The
 * live listing keeps rows a queued write owns (`mergeLiveDocsListing`).
 */
export function useDocsListingReconnectRefresh(
  username: string | null,
  fetchLiveListing: (signal: AbortSignal) => Promise<boolean>,
  setRefreshing: (refreshing: boolean) => void,
): void {
  useOnReconnect(
    useCallback(() => {
      if (!username) return;
      void (async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        if (!getConnectivitySnapshot()) return;
        const controller = new AbortController();
        setRefreshing(true);
        await fetchLiveListing(controller.signal);
        setRefreshing(false);
      })();
    }, [fetchLiveListing, setRefreshing, username]),
  );
}
