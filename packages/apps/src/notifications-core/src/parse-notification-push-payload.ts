import {
  sanitizeNotificationNavigate,
  WEB_PUSH_DECLARATIVE_VERSION,
} from "@/lib/notifications/notification-click-navigate";
import type { NotificationInboxItem } from "@/lib/models/notifications-types";
import { isPushScope, ROOT_PUSH_SCOPE, type PushScope } from "@/lib/notifications/push-scope";

export type NotificationPushPayload = {
  title: string;
  body: string;
  navigate: string;
  tag: string;
  renotify: boolean;
  app_badge: number;
  declarative: boolean;
  /** Scope of the app this subscription belongs to (#1606); `/` for older payloads. */
  scope: PushScope;
  /**
   * The inbox row this push is about, for a visible window to show before its
   * own fetch (#1670). Null for payloads without an inbox id.
   */
  item: NotificationInboxItem | null;
};

export function parseNotificationPushPayload(raw: unknown): NotificationPushPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const nested =
    typeof data.notification === "object" && data.notification !== null
      ? (data.notification as Record<string, unknown>)
      : null;
  const source = nested ?? data;
  const title = typeof source.title === "string" ? source.title : "";
  if (!title) return null;
  const body = typeof source.body === "string" ? source.body : "";
  const navigate = sanitizeNotificationNavigate(source.navigate ?? data.navigate);
  const tag = typeof source.tag === "string" && source.tag !== "" ? source.tag : "wgw-notify";
  return {
    title,
    body,
    navigate,
    tag,
    renotify: source.renotify !== false && data.renotify !== false,
    app_badge: typeof source.app_badge === "number" ? source.app_badge : 1,
    declarative: data.web_push === WEB_PUSH_DECLARATIVE_VERSION,
    scope: isPushScope(data.scope) ? data.scope : ROOT_PUSH_SCOPE,
    item: inboxItemFromPayload(data, { title, body, navigate, tag }),
  };
}

function inboxItemFromPayload(
  data: Record<string, unknown>,
  copy: { title: string; body: string; navigate: string; tag: string },
): NotificationInboxItem | null {
  const id = typeof data.id === "string" ? data.id.trim() : "";
  if (id === "") return null;
  return {
    id,
    domain: typeof data.domain === "string" ? data.domain : "",
    action: typeof data.action === "string" ? data.action : "",
    data: null,
    title: copy.title,
    body: copy.body === "" ? null : copy.body,
    navigate: copy.navigate,
    tag: copy.tag,
    readAt: null,
    createdAt: typeof data.created_at === "string" ? data.created_at : null,
  };
}
