/**
 * Which built files the service worker precaches (#1628). Install fetches the
 * shell: what `index.html` loads, plus non-script assets. A lazy app chunk is
 * cached the first time its route requests it (`isLazyAssetRequest`), so
 * opening one app does not download the others.
 */

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
