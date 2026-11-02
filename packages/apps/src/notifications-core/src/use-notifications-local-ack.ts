import { useCallback, useEffect, useRef } from "react";
import { ackLocalNotification } from "@/lib/api/wgw/notifications";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import type { MeetCallStore } from "@/meet-core/src/meet-call-store";
import { canLocalAck } from "@/notifications-core/src/local-ack-gate";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";

function currentVisibility(): string {
  return typeof document === "undefined" ? "visible" : document.visibilityState;
}

/** The lobby (`waiting`) and set-up (`preparing`) are not a call yet. */
function inMeetCall(store: MeetCallStore | null): boolean {
  return store?.statusRef.current === "in-call";
}

/**
 * Local-acks unread inbox rows, but only from a visible window or one in a Meet
 * call (see {@link canLocalAck}). A hidden window keeps what it saw and acks it
 * when it becomes visible or joins a call. Until then the VAPID sweep pushes as
 * usual. Returns the callback the poller calls with each fresh unread list.
 */
export function useNotificationsLocalAck(): (unread: readonly NotificationInboxItem[]) => void {
  const callStore = useMeetCallStoreContext();
  const unreadRef = useRef<readonly NotificationInboxItem[]>([]);
  /** Ids acked (or in flight) for rows still unread. */
  const ackedRef = useRef<Set<string>>(new Set());

  const flush = useCallback(() => {
    if (!canLocalAck(currentVisibility(), inMeetCall(callStore))) return;
    const acked = ackedRef.current;
    for (const item of unreadRef.current) {
      if (acked.has(item.id)) continue;
      acked.add(item.id);
      void ackLocalNotification(item.id).catch(() => {
        // Try again on the next poll or visibility change.
        acked.delete(item.id);
      });
    }
  }, [callStore]);

  const trackUnread = useCallback(
    (unread: readonly NotificationInboxItem[]) => {
      unreadRef.current = unread;
      const live = new Set(unread.map((item) => item.id));
      for (const id of ackedRef.current) {
        if (!live.has(id)) ackedRef.current.delete(id);
      }
      flush();
    },
    [flush],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [flush]);

  useEffect(() => {
    if (!callStore) return;
    return callStore.subscribe(flush);
  }, [callStore, flush]);

  return trackUnread;
}
