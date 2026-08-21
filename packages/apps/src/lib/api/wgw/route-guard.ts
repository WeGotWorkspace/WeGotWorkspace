import { redirect } from "@tanstack/react-router";
import { wgwHasAuthenticatedSession, wgwLiveApiEnabled } from "@/lib/api/wgw/http";

type RouteLocationLike = {
  href?: string;
  pathname?: string;
  searchStr?: string;
  hash?: string;
};

const AUTH_ROUTE_PREFIXES = ["/login", "/logout"] as const;

const PUBLIC_ROUTE_PREFIXES = ["/share", "/meet/guest", "/meet/join"] as const;

const ALLOWED_RETURN_PREFIXES = [
  "/",
  "/admin",
  "/apps",
  "/calendar",
  "/contacts",
  "/docs",
  "/drive",
  "/install",
  "/mail",
  "/meet",
  "/notes",
  "/settings",
  "/tasks",
];

const MAX_RETURN_UNWRAP_DEPTH = 16;

function normalizePathname(pathname: string): string {
  const withLeading = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const collapsed = withLeading.replace(/\/{2,}/g, "/");
  if (collapsed.length > 1 && collapsed.endsWith("/")) {
    return collapsed.slice(0, -1);
  }
  return collapsed;
}

export function isWgwAuthRoutePathname(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return AUTH_ROUTE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

/** Routes that must stay reachable without a member login session. */
export function isWgwPublicRoutePathname(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function parseRelativePath(raw: string): URL | null {
  const input = raw.trim();
  if (!input.startsWith("/") || input.startsWith("//")) return null;
  try {
    return new URL(input, "https://wgw.local");
  } catch {
    return null;
  }
}

/** Unwrap nested `/login?return=…` chains left by redirect loops. */
function unwrapAuthReturnChain(raw: string, depth = 0): string {
  if (depth > MAX_RETURN_UNWRAP_DEPTH) return "/";
  const url = parseRelativePath(raw);
  if (!url) return "/";

  const pathname = normalizePathname(url.pathname || "/");
  if (!isWgwAuthRoutePathname(pathname)) {
    return `${pathname}${url.search}${url.hash}`;
  }

  const innerReturn = url.searchParams.get("return")?.trim();
  if (innerReturn) {
    return unwrapAuthReturnChain(innerReturn, depth + 1);
  }

  return "/";
}

function isAllowedReturnPath(pathname: string): boolean {
  return ALLOWED_RETURN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function sanitizeWgwReturnPath(raw: string | null | undefined): string {
  const unwrapped = unwrapAuthReturnChain(raw ?? "");
  const url = parseRelativePath(unwrapped);
  if (!url) return "/";

  const pathname = normalizePathname(url.pathname || "/");
  if (!isAllowedReturnPath(pathname)) return "/";

  return `${pathname}${url.search}${url.hash}`;
}

/** Safe post-login destination for `window.location` or router redirects. */
export function buildWgwLoginHref(returnPath?: string | null): string {
  const safe = sanitizeWgwReturnPath(returnPath);
  if (safe === "/") return "/login";
  return `/login?return=${encodeURIComponent(safe)}`;
}

/**
 * Keep navigation on the current SPA origin. Absolute API-bind URLs (local :9080)
 * from `logoutUrl` / mail links must not pull the user off Vite.
 */
export function resolveWgwSameOriginHref(
  href: string | null | undefined,
  fallback: string,
): string {
  if (typeof href !== "string") return fallback;
  const trimmed = href.trim();
  if (trimmed === "") return fallback;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (typeof window !== "undefined" && url.origin === window.location.origin) {
      const next = `${url.pathname}${url.search}${url.hash}`;
      return next === "" ? fallback : next;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function returnPathFromLocation(location: RouteLocationLike | undefined): string {
  if (!location) return "/";
  const href = typeof location.href === "string" ? location.href : "";
  if (href.startsWith("/")) return sanitizeWgwReturnPath(href);
  const pathname = typeof location.pathname === "string" ? location.pathname : "/";
  const search = typeof location.searchStr === "string" ? location.searchStr : "";
  const hash = typeof location.hash === "string" ? location.hash : "";
  return sanitizeWgwReturnPath(`${pathname}${search}${hash}`);
}

/**
 * Redirect protected routes to /login when no browser auth session exists.
 */
export function requireWgwAuth(location?: RouteLocationLike): void {
  if (!wgwLiveApiEnabled()) return;
  if (wgwHasAuthenticatedSession()) return;
  throw redirect({
    to: "/login",
    search: {
      return: returnPathFromLocation(location),
    },
  });
}
