import type { NotificationInboxItem } from "@/lib/models/notifications-types";
import { WORKSPACE_APP_IDS, type WorkspaceAppId } from "@/lib/workspace-app-icons";
import { notificationInboxAppId } from "@/notifications-core/src/notification-inbox-row-meta";

/**
 * Which notifications the user wants in view: every app's, or only those of the
 * app they are in. Picked in the inbox tray; the bell count and the toasts follow.
 * Device-local (localStorage), like the sound mute.
 */
export type NotificationScope = "all" | "app";

export const NOTIFICATION_SCOPE_STORAGE_KEY = "wgw.notifications.tray-scope";

/** Apps that raise no notifications of their own: the scope does not apply there. */
const UNSCOPED_APP_IDS = new Set<WorkspaceAppId>(["settings", "admin"]);

export function readNotificationScope(): NotificationScope {
  try {
    return window.localStorage.getItem(NOTIFICATION_SCOPE_STORAGE_KEY) === "app" ? "app" : "all";
  } catch {
    return "all";
  }
}

export function storeNotificationScope(scope: NotificationScope): void {
  try {
    window.localStorage.setItem(NOTIFICATION_SCOPE_STORAGE_KEY, scope);
  } catch {
    // Private mode or blocked storage: the scope just resets on reload.
  }
}

/** The product app at `route` (a path, with or without a query), if the scope applies there. */
export function notificationScopeAppAt(route: string): WorkspaceAppId | undefined {
  const pathname = route.split(/[?#]/, 1)[0] ?? "";
  const app = WORKSPACE_APP_IDS.find(
    (id) => pathname === `/${id}` || pathname.startsWith(`/${id}/`),
  );
  return app && !UNSCOPED_APP_IDS.has(app) ? app : undefined;
}

/**
 * Whether `item` is in the picked scope for someone looking at `route`. Always
 * true for "all", and where the scope does not apply (home, Settings, Admin).
 */
export function notificationInScope(
  item: Pick<NotificationInboxItem, "domain" | "navigate">,
  route: string,
  scope: NotificationScope = readNotificationScope(),
): boolean {
  if (scope === "all") return true;
  const app = notificationScopeAppAt(route);
  return app == null || notificationInboxAppId(item) === app;
}

/**
 * Whether `item` is in the Project filter's scope: `projectIds` are the Projects the filter
 * keeps (one Project, every Project of a Team), null for "All Projects". A row with no
 * Project (a DM, a personal invite) is always in scope, so it never disappears.
 */
export function notificationInProjectScope(
  item: Pick<NotificationInboxItem, "projectId">,
  projectIds: readonly string[] | null,
): boolean {
  if (projectIds == null || item.projectId == null) return true;
  return projectIds.includes(item.projectId);
}
