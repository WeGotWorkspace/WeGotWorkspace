import type { FrontTab } from "@/lib/jmap-client/push/front-tab";
import { normalizeNotificationNavigate } from "@/notifications-core/src/notification-consume-match";
import {
  browserStorage,
  createIdListStore,
  type IdListStore,
} from "@/notifications-core/src/id-list-store";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";

/** Rows whose toast this browser already decided on: shown, or skipped because no tab was visible. */
export const TOAST_DECIDED_STORAGE_KEY = "wgw.offline.notifications.toastDecided";

/** Same cap as the local-ack list: several pages of the unread inbox. */
export const TOAST_DECIDED_MAX_IDS = 500;

export type ToastDecisionDeps = {
  /** The tab the user is looking at (the push hub's election), or null when every tab is hidden. */
  frontTab: () => Promise<Pick<FrontTab, "self" | "route"> | null>;
  decided: IdListStore;
  /** This tab's screen when the hub has no route for it yet. */
  currentRoute: () => string;
};

export function browserToastDecidedStore(): IdListStore {
  return createIdListStore(browserStorage(), TOAST_DECIDED_STORAGE_KEY, TOAST_DECIDED_MAX_IDS);
}

function parsePath(path: string): URL | null {
  try {
    return new URL(path, "http://wgw.invalid");
  } catch {
    return null;
  }
}

/**
 * True when the screen at `route` already shows what `navigate` opens: the
 * same path (DM peers compared case-insensitively), and every query parameter
 * of `navigate` present in `route` with the same value. `/` never matches.
 */
export function routeShowsNavigate(route: string, navigate: string): boolean {
  const open = parsePath(route);
  const target = parsePath(normalizeNotificationNavigate(navigate));
  if (!open || !target) return false;
  const targetPath = normalizeNotificationNavigate(target.pathname);
  if (targetPath === "/" || normalizeNotificationNavigate(open.pathname) !== targetPath) {
    return false;
  }
  for (const [key, value] of target.searchParams) {
    if (!open.searchParams.getAll(key).includes(value)) return false;
  }
  return true;
}

/**
 * The rows of `fresh` (new unread rows this tab just saw) that this tab shows
 * as a toast (docs/architecture/notifications.md, "Active news on the
 * client"). Each row is decided once per browser:
 *
 * - no tab is visible: no toast anywhere, now or later; Web Push is the only
 *   OS notification path (#1605);
 * - another tab is in front: that tab decides when it sees the row;
 * - this tab is in front: it toasts the row, unless the row's `navigate`
 *   points at the screen it shows (the row still goes to the popover).
 */
export async function pickRowsToToast(
  fresh: readonly NotificationInboxItem[],
  deps: ToastDecisionDeps,
): Promise<NotificationInboxItem[]> {
  const undecided = (rows: readonly NotificationInboxItem[]) => {
    const decided = deps.decided.read();
    return rows.filter((row) => row.readAt == null && !decided.has(row.id));
  };
  if (undecided(fresh).length === 0) return [];
  const front = await deps.frontTab();
  if (front && !front.self) return [];
  // Another tab may have decided while the election ran.
  const rows = undecided(fresh);
  deps.decided.add(rows.map((row) => row.id));
  if (!front) return [];
  const route = front.route ?? deps.currentRoute();
  return rows.filter((row) => !routeShowsNavigate(route, row.navigate));
}
