/**
 * Which built files the service worker precaches (#1628). Install fetches the
 * shell: what `index.html` loads, plus non-script assets. A lazy app chunk is
 * cached the first time its route requests it (`isLazyAssetRequest`), so
 * opening one app does not download the others.
 */

/** Written next to `index.html` by the build: the hashed chunks the precache leaves out. */
export const LAZY_ASSETS_LIST = "lazy-assets.json";

const HASHED_ASSET = /^\/?assets\/.+\.(js|css)$/;

/** Hashed script and style URLs that `index.html` names (entry, modulepreload, stylesheet). */
export function shellAssetUrls(indexHtml: string): Set<string> {
  const urls = new Set<string>();
  for (const match of indexHtml.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    urls.add(match[1]!.replace(/^\/+/, ""));
  }
  return urls;
}

/** Keeps a precache entry unless it is a hashed script or style that the shell does not load. */
export function isShellPrecacheEntry(url: string, shell: ReadonlySet<string>): boolean {
  if (!HASHED_ASSET.test(url)) return true;
  return shell.has(url.replace(/^\/+/, ""));
}

/** A same-origin hashed script or style, cached at runtime when a lazy route requests it. */
export function isLazyAssetRequest(url: URL, origin: string): boolean {
  return url.origin === origin && /^\/assets\/.+\.(js|css)$/.test(url.pathname);
}

/** `/assets/contacts-a1B2c3D4.js` → `/assets/contacts.js`: the file name without Vite's content hash. */
export function lazyAssetName(path: string): string {
  return path.replace(/-[A-Za-z0-9_-]{8}(\.(?:js|css))$/, "$1");
}

export type LazyAssetPlan = {
  /** New-build chunks to download: the replacement of every cached chunk that changed. */
  fetch: string[];
  /** Cached chunks the new build does not request. */
  delete: string[];
};

/**
 * What a deploy does to the lazy asset cache. Hashed names are content hashes,
 * so a cached chunk the new build still lists is unchanged and stays. One it
 * does not list is deleted, and the new build's chunks of the same name are
 * fetched, so an app opened once still opens offline after the deploy.
 * Both inputs are URL paths such as `/assets/contacts-a1B2c3D4.js`.
 */
export function planLazyAssetSync(
  cached: readonly string[],
  next: readonly string[],
): LazyAssetPlan {
  const nextSet = new Set(next);
  const cachedSet = new Set(cached);
  const removed = cached.filter((path) => !nextSet.has(path));
  const changedNames = new Set(removed.map(lazyAssetName));
  const fetch = next.filter(
    (path) => !cachedSet.has(path) && changedNames.has(lazyAssetName(path)),
  );
  return { fetch, delete: removed };
}
