import { isLazyAssetRequest } from "./precache-shell";

/** Shared with `src/sw.ts`, which answers lazy chunk requests from it. */
export const LAZY_ASSET_CACHE = "wgw-lazy-assets";

async function storeLazyAsset(url: string): Promise<void> {
  try {
    const cache = await caches.open(LAZY_ASSET_CACHE);
    if (await cache.match(url)) return;
    // The page just loaded this file, so the HTTP cache usually answers.
    const response = await fetch(url, { cache: "force-cache" });
    if (response.ok) await cache.put(url, response);
  } catch {
    // Best effort: the worker caches the chunk when it handles the next fetch.
  }
}

/**
 * Copies the hashed scripts and styles the page already loaded into the lazy
 * asset cache. On a cold load the lazy chunk is fetched before the worker
 * takes control, so the worker never sees it (#1628). Offline reload of an app
 * opened once needs the chunk, so the window stores it itself.
 */
export function cacheLoadedLazyAssets(): void {
  if (typeof caches === "undefined" || typeof performance === "undefined") return;
  const seen = new Set<string>();
  const handle = (entries: readonly PerformanceEntry[]): void => {
    for (const entry of entries) {
      if (seen.has(entry.name)) continue;
      let url: URL;
      try {
        url = new URL(entry.name, location.href);
      } catch {
        continue;
      }
      if (!isLazyAssetRequest(url, location.origin)) continue;
      seen.add(entry.name);
      void storeLazyAsset(url.href);
    }
  };
  handle(performance.getEntriesByType("resource"));
  if (typeof PerformanceObserver === "undefined") return;
  try {
    new PerformanceObserver((list) => handle(list.getEntries())).observe({
      type: "resource",
      buffered: true,
    });
  } catch {
    // Resource timing unsupported: the buffered entries above are all we get.
  }
}
