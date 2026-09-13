export type NotificationPushPayload = {
  title: string;
  body: string;
  navigate: string;
  tag: string;
  renotify: boolean;
  app_badge: number;
};

export function parseNotificationPushPayload(raw: unknown): NotificationPushPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title : "";
  if (!title) return null;
  return {
    title,
    body: typeof data.body === "string" ? data.body : "",
    navigate:
      typeof data.navigate === "string" && data.navigate.startsWith("/") ? data.navigate : "/",
    tag: typeof data.tag === "string" && data.tag !== "" ? data.tag : "wgw-notify",
    renotify: data.renotify !== false,
    app_badge: typeof data.app_badge === "number" ? data.app_badge : 1,
  };
}
