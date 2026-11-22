import { createElement, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { CUSTOM_TOAST_FRAME_CLASS } from "@/hooks/use-app-toast";
import { defaultJmapPushHub } from "@/lib/api/wgw/jmap-push";
import {
  browserToastDecidedStore,
  pickRowsToToast,
  trackVisibleSince,
  type ToastDecisionDeps,
} from "@/notifications-core/src/notification-toast-decision";
import { NotificationToast } from "@/notifications-core/src/notification-toast";
import {
  notificationInProjectScope,
  notificationInScope,
} from "@/notifications-core/src/notification-scope";
import { useSelectedProjectIds } from "@/lib/projects/use-project-filter";
import type { NotificationInboxItem } from "@/lib/models/notifications-types";

/** Long enough to read a title and a line of body; hovering or focusing the toasts pauses it. */
export const NOTIFICATION_TOAST_DURATION_MS = 8_000;

/** Show `item` as a toast in this tab; the caller decided this tab should (see pickRowsToToast). */
export function showNotificationToast(
  item: NotificationInboxItem,
  onOpen: (item: NotificationInboxItem) => void,
  duration: number = NOTIFICATION_TOAST_DURATION_MS,
): string | number {
  return toast.custom((id) => createElement(NotificationToast, { toastId: id, item, onOpen }), {
    id: `notification-${item.id}`,
    duration,
    className: CUSTOM_TOAST_FRAME_CLASS,
    style: { width: "100%", maxWidth: "100%" },
    position: "bottom-right",
  });
}

export type NotificationToastDeps = ToastDecisionDeps & {
  show: (item: NotificationInboxItem, onOpen: (item: NotificationInboxItem) => void) => void;
};

export function defaultNotificationToastDeps(
  projectIds: () => readonly string[] | null = () => null,
): NotificationToastDeps {
  return {
    frontTab: async () => {
      const hub = defaultJmapPushHub();
      if (hub) return hub.frontTab();
      // Mock data has no hub: this tab is the only one.
      return document.visibilityState === "visible" ? { self: true, route: null } : null;
    },
    decided: browserToastDecidedStore(),
    currentRoute: () => window.location.pathname + window.location.search,
    visibleSince: trackVisibleSince(),
    // Read at decision time, so a scope picked in the tray or a Project picked in the
    // sidebar applies to the next toast. Both must pass; the row still reaches the tray.
    inScope: (row, route) =>
      notificationInScope(row, route) && notificationInProjectScope(row, projectIds()),
    show: showNotificationToast,
  };
}

/**
 * In-app toasts for active news (#1669). Returns the callback the inbox calls
 * with the unread rows it sees for the first time; the rows this tab should
 * show (see {@link pickRowsToToast}) appear as toasts, newest on top, and a
 * click runs `onOpen`.
 */
export function useNotificationToasts(
  onOpen: (item: NotificationInboxItem) => void,
  createDeps?: () => NotificationToastDeps,
): (fresh: readonly NotificationInboxItem[]) => void {
  const projectIds = useSelectedProjectIds();
  const projectIdsRef = useRef(projectIds);
  useEffect(() => {
    projectIdsRef.current = projectIds;
  }, [projectIds]);
  const depsRef = useRef<NotificationToastDeps | null>(null);
  depsRef.current ??= createDeps
    ? createDeps()
    : defaultNotificationToastDeps(() => projectIdsRef.current);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  return useCallback((fresh: readonly NotificationInboxItem[]) => {
    const deps = depsRef.current;
    if (!deps || fresh.length === 0) return;
    void pickRowsToToast(fresh, deps).then((rows) => {
      // The inbox lists newest first; the last toast shown sits on top.
      for (const row of [...rows].reverse()) deps.show(row, (item) => onOpenRef.current(item));
    });
  }, []);
}
