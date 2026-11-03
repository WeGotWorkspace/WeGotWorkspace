import { useCallback, useEffect, useRef } from "react";
import { ackLocalNotification } from "@/lib/api/wgw/notifications";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import type { MeetCallStore } from "@/meet-core/src/meet-call-store";
import { canLocalAck } from "@/notifications-core/src/local-ack-gate";
import {
  defaultLocalAckClaims,
  type LocalAckClaims,
} from "@/notifications-core/src/local-ack-claims";
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
 * usual. Two visible tabs never both ack a row: each row is claimed with a Web
 * Lock first ({@link LocalAckClaims}). Returns the callback the inbox calls
 * with each fresh unread list.
 */
export function useNotificationsLocalAck(
  createClaims: () => LocalAckClaims = defaultLocalAckClaims,
): (unread: readonly NotificationInboxItem[]) => void {
  const callStore = useMeetCallStoreContext();
  const unreadRef = useRef<readonly NotificationInboxItem[]>([]);
  /** Ids acked (or claim/ack in flight) for rows still unread. */
  const ackedRef = useRef<Set<string>>(new Set());
  const claimsRef = useRef<LocalAckClaims | null>(null);
  claimsRef.current ??= createClaims();

  const flush = useCallback(() => {
    if (!canLocalAck(currentVisibility(), inMeetCall(callStore))) return;
    const acked = ackedRef.current;
    const claims = claimsRef.current;
    if (!claims) return;
    for (const item of unreadRef.current) {
      if (acked.has(item.id)) continue;
      acked.add(item.id);
      void claims.claim(item.id).then((claimed) => {
        const stillUnread = unreadRef.current.some((row) => row.id === item.id);
        if (!claimed || !stillUnread) {
          // Another tab acks it, or it was read meanwhile. Try again on the next flush.
          acked.delete(item.id);
          if (claimed) claims.release(item.id);
          return;
        }
        void ackLocalNotification(item.id).catch(() => {
          // Try again on the next poll or visibility change.
          acked.delete(item.id);
          claims.release(item.id);
        });
      });
    }
  }, [callStore]);

  const trackUnread = useCallback(
    (unread: readonly NotificationInboxItem[]) => {
      unreadRef.current = unread;
      const live = new Set(unread.map((item) => item.id));
      for (const id of ackedRef.current) {
        if (live.has(id)) continue;
        ackedRef.current.delete(id);
        claimsRef.current?.release(id);
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
    const claims = claimsRef.current;
    return () => claims?.releaseAll();
  }, []);

  useEffect(() => {
    if (!callStore) return;
    return callStore.subscribe(flush);
  }, [callStore, flush]);

  return trackUnread;
}
