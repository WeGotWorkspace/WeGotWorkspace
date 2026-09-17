import { WORKSPACE_APP_IDS, type WorkspaceAppId } from "@/lib/workspace-app-icons";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";

const DOMAIN_APP: Record<string, WorkspaceAppId> = {
  chat: "meet",
  meet: "meet",
  calendar: "calendar",
  tasks: "tasks",
  notes: "notes",
  docs: "docs",
  drive: "drive",
};

/** Product icon for a tray row — chat lives in Meet. */
export function notificationInboxAppId(
  item: Pick<NotificationInboxItem, "domain" | "navigate">,
): WorkspaceAppId {
  if (item.domain === "docs" && item.navigate.startsWith("/drive")) {
    return "drive";
  }
  const mapped = DOMAIN_APP[item.domain.toLowerCase()];
  if (mapped) return mapped;
  const match = WORKSPACE_APP_IDS.find(
    (id) => item.navigate === `/${id}` || item.navigate.startsWith(`/${id}/`),
  );

  return match ?? "meet";
}

/** Readable product label for the tray meta row (`Meet`, `Calendar`, …). */
export function notificationInboxDomainLabel(appId: WorkspaceAppId): string {
  return appId.charAt(0).toUpperCase() + appId.slice(1);
}

/** Compact relative age matching the tray mockup (`4m`, `22m`, `1h`). */
export function formatNotificationRelativeTime(
  iso: string | null,
  nowMs: number = Date.now(),
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Math.max(0, nowMs - date.getTime());
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHour < 24) return `${diffHour}h`;
  if (diffDay < 7) return `${diffDay}d`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
