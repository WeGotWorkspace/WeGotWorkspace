import { buildWgwLoginHref, isWgwPublicRoutePathname } from "@/lib/api/wgw/route-guard";
import {
  isPushScope,
  isWithinPushScope,
  normalizePushPath,
  ROOT_PUSH_SCOPE,
  type PushScope,
} from "./push-scope";

export const WGW_NOTIFICATION_NAVIGATE_MESSAGE = "wgw-notification-navigate";

export const WEB_PUSH_DECLARATIVE_VERSION = 8030;

/** Same-origin path for inbox, Notification API, and SW data.navigate. */
export function sanitizeNotificationNavigate(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const trimmed = raw.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "/";
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith("/") ? path : "/";
  } catch {
    return "/";
  }
}

export function resolveNotificationNavigateHref(raw: unknown, origin: string): string {
  const path = sanitizeNotificationNavigate(raw);
  try {
    return new URL(path, origin).href;
  } catch {
    return origin.endsWith("/") ? `${origin.slice(0, -1)}/` : `${origin}/`;
  }
}

export type NotificationClickTarget = { href: string; path: string; scope: PushScope };

/**
 * Where a notification click opens (#1606): the deep link when it lies inside
 * the scope of the app that received the push, otherwise that app's start.
 * A missing or unknown scope (older payloads) is the suite scope.
 */
export function notificationClickTarget(
  navigate: unknown,
  scope: unknown,
  origin: string,
): NotificationClickTarget {
  const appScope = isPushScope(scope) ? scope : ROOT_PUSH_SCOPE;
  // Normalised, so `/docs/../calendar` counts as the Calendar link it opens.
  const deepLink = normalizePushPath(sanitizeNotificationNavigate(navigate));
  const path = isWithinPushScope(deepLink, appScope) ? deepLink : appScope;
  return { href: resolveNotificationNavigateHref(path, origin), path, scope: appScope };
}

/**
 * The open window to reuse: the first one already inside the app's scope.
 * Null means open a new window, so one app never takes over another's window.
 */
export function pickNotificationClient<T extends { url: string }>(
  clients: readonly T[],
  scope: string,
): T | null {
  for (const client of clients) {
    let path: string;
    try {
      path = new URL(client.url).pathname;
    } catch {
      continue;
    }
    if (isWithinPushScope(path, scope)) return client;
  }
  return null;
}

export function notificationNavigateFromMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== WGW_NOTIFICATION_NAVIGATE_MESSAGE) return null;
  const path = sanitizeNotificationNavigate(record.navigate);
  return path;
}

export function assignNotificationNavigate(
  path: string,
  hasSession: boolean,
  assign: (href: string) => void,
): void {
  const safe = sanitizeNotificationNavigate(path);
  if (!hasSession && !isWgwPublicRoutePathname(safe.split("?")[0] ?? safe)) {
    assign(buildWgwLoginHref(safe));
    return;
  }
  assign(safe);
}

export function isSafariDeclarativeWebPushUserAgent(ua: string): boolean {
  return /Version\/.*Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg\//.test(ua);
}
