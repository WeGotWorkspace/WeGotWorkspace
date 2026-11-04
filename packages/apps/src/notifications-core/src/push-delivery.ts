import type { NotificationInboxItem } from "./notifications-types";

/** Service worker → window: an inbox row that just arrived by Web Push (#1670). */
export const WGW_NOTIFICATION_PUSHED_MESSAGE = "wgw-notification-pushed";

export type PushEngine = "chromium" | "firefox-desktop" | "other";

/**
 * Which push rules the browser follows, read from the user agent. See the
 * spike table in docs/architecture/notifications.md ("May the service worker
 * skip the OS notification?").
 */
export function pushEngine(userAgent: string): PushEngine {
  // Chrome on iOS ("CriOS") is WebKit and has no "Chrome/" token.
  if (/\b(?:Chrome|Chromium|HeadlessChrome|Edg)\//.test(userAgent)) return "chromium";
  if (/\bFirefox\//.test(userAgent) && !/Android/.test(userAgent)) return "firefox-desktop";
  return "other";
}

/**
 * Whether the browser accepts a push without an OS notification while a page
 * of the site is visible. Chromium exempts a visible tab; Firefox desktop
 * resets its quota while a tab is open. WebKit never allows a silent push, and
 * Firefox for Android charges it against a quota.
 */
export function browserMaySkipPushNotification(userAgent: string): boolean {
  return pushEngine(userAgent) !== "other";
}

export type PushWindowLike = { readonly visibilityState: string };

export type PushDeliveryPlan<C> = {
  /** Visible windows that get the item posted. */
  postTo: C[];
  /** False only when a visible window got the item and the browser allows skipping. */
  showNotification: boolean;
};

/**
 * What the service worker does with a push: post the item to every visible
 * window, and show the OS notification unless a visible window already has it
 * and the browser allows the skip.
 */
export function pushDeliveryPlan<C extends PushWindowLike>(
  windows: readonly C[],
  userAgent: string,
  item: NotificationInboxItem | null,
): PushDeliveryPlan<C> {
  const postTo = item ? windows.filter((client) => client.visibilityState === "visible") : [];
  return {
    postTo,
    showNotification: postTo.length === 0 || !browserMaySkipPushNotification(userAgent),
  };
}

/** The item of a {@link WGW_NOTIFICATION_PUSHED_MESSAGE}, or null for any other message. */
export function pushedItemFromMessage(data: unknown): NotificationInboxItem | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as { type?: unknown; item?: unknown };
  if (message.type !== WGW_NOTIFICATION_PUSHED_MESSAGE) return null;
  const item = message.item as Partial<NotificationInboxItem> | null | undefined;
  if (!item || typeof item.id !== "string" || item.id === "" || typeof item.title !== "string") {
    return null;
  }
  return {
    id: item.id,
    domain: typeof item.domain === "string" ? item.domain : "",
    action: typeof item.action === "string" ? item.action : "",
    data: null,
    title: item.title,
    body: typeof item.body === "string" ? item.body : null,
    navigate: typeof item.navigate === "string" ? item.navigate : "/",
    tag: typeof item.tag === "string" ? item.tag : null,
    readAt: null,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
  };
}
