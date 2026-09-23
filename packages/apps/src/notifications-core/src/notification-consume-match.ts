import { sanitizeNotificationNavigate } from "@/notifications-core/src/notification-click-navigate";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";

/**
 * Normalize an inbox / consume navigate path for equality: strip trailing slash,
 * decode URI segments, lowercase DM peer ids (server stores lowercased usernames).
 */
export function normalizeNotificationNavigate(path: string): string {
  const sanitized = sanitizeNotificationNavigate(path).replace(/\/+$/, "") || "/";
  let decoded = sanitized;
  try {
    decoded = decodeURIComponent(sanitized);
  } catch {
    // Keep sanitized when the path is malformed.
  }
  const dm = /^\/meet\/dms\/([^/]+)$/i.exec(decoded);
  if (dm?.[1]) {
    return `/meet/dms/${dm[1].toLowerCase()}`;
  }
  return decoded;
}

/** True when the inbox row's navigate targets the conversation the user is viewing. */
export function notificationMatchesNavigate(
  item: Pick<NotificationInboxItem, "navigate">,
  consumedNavigate: string,
): boolean {
  const consumed = normalizeNotificationNavigate(consumedNavigate);
  if (consumed === "/" || consumed === "") return false;
  return normalizeNotificationNavigate(item.navigate) === consumed;
}

function normalizeDocsApiPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

/**
 * docs.shared rows navigate only to `/docs` or `/drive`; match the shared file via
 * structured `data.path` against the open Docs (or Drive) API path.
 */
export function notificationMatchesDocsSharedPath(
  item: Pick<NotificationInboxItem, "domain" | "action" | "data">,
  apiPath: string,
): boolean {
  if (item.domain !== "docs" || item.action !== "shared") return false;
  const open = normalizeDocsApiPath(apiPath);
  if (!open || open === "/") return false;
  const raw = item.data?.path;
  if (typeof raw !== "string") return false;
  return normalizeDocsApiPath(raw) === open;
}
