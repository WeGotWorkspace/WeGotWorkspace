import {
  sanitizeNotificationNavigate,
  WEB_PUSH_DECLARATIVE_VERSION,
} from "./notification-click-navigate";

export type NotificationPushPayload = {
  title: string;
  body: string;
  navigate: string;
  tag: string;
  renotify: boolean;
  app_badge: number;
  declarative: boolean;
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
  return {
    title,
    body: typeof source.body === "string" ? source.body : "",
    navigate: sanitizeNotificationNavigate(source.navigate ?? data.navigate),
    tag: typeof source.tag === "string" && source.tag !== "" ? source.tag : "wgw-notify",
    renotify: source.renotify !== false && data.renotify !== false,
    app_badge: typeof source.app_badge === "number" ? source.app_badge : 1,
    declarative: data.web_push === WEB_PUSH_DECLARATIVE_VERSION,
  };
}
