import { buildWgwLoginHref, isWgwPublicRoutePathname } from "@/lib/api/wgw/route-guard";

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
