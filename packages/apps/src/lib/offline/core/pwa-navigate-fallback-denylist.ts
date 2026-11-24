/**
 * Workbox `navigateFallbackDenylist` — pathname+search patterns that must hit
 * the network instead of the SPA `index.html` shell.
 *
 * `/oauth/*` and `/mcp` are Laravel (Passport + MCP). If they fall through to
 * the PWA, Claude/ChatGPT consent navigations render the in-app 404 page.
 * The `/login` step of that flow also goes to the network: the cached shell
 * carries COOP, which would cut a popup client's `window.opener`.
 */
export const PWA_NAVIGATE_FALLBACK_DENYLIST: readonly RegExp[] = [
  /^\/api\//,
  /^\/apps\//,
  /^\/oauth(?:\/|$)/,
  /^\/mcp(?:\/|$)/,
  /^\/login\?(?:.*&)?return=(?:%2F|\/)oauth(?:%2F|\/)authorize(?:$|&|%3F|\?)/i,
  /^\/\.well-known\/oauth-(?:authorization-server|protected-resource)/,
];

/** Workbox matches denylist against `url.pathname + url.search`. */
export function isPwaNavigateFallbackDenied(pathnameAndSearch: string): boolean {
  return PWA_NAVIGATE_FALLBACK_DENYLIST.some((pattern) => pattern.test(pathnameAndSearch));
}
