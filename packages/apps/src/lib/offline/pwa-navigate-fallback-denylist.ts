/**
 * Workbox `navigateFallbackDenylist` — pathname+search patterns that must hit
 * the network instead of the SPA `index.html` shell.
 *
 * `/oauth/*` and `/mcp` are Laravel (Passport + MCP). If they fall through to
 * the PWA, Claude/ChatGPT consent navigations render the in-app 404 page.
 */
export const PWA_NAVIGATE_FALLBACK_DENYLIST: readonly RegExp[] = [
  /^\/api\//,
  /^\/apps\//,
  /^\/oauth(?:\/|$)/,
  /^\/mcp(?:\/|$)/,
  /^\/\.well-known\/oauth-(?:authorization-server|protected-resource)/,
];

/** Workbox matches denylist against `url.pathname + url.search`. */
export function isPwaNavigateFallbackDenied(pathnameAndSearch: string): boolean {
  return PWA_NAVIGATE_FALLBACK_DENYLIST.some((pattern) => pattern.test(pathnameAndSearch));
}
