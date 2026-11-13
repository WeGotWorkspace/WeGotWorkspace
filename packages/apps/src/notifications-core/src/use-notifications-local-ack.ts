import { useCallback, useEffect, useRef } from "react";
import { ackLocalNotifications } from "@/lib/api/wgw/notifications";
import { withCrossTabLock } from "@/lib/offline/core/cross-tab-lock";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import type { MeetCallStore } from "@/meet-core/src/meet-call-store";
import { canLocalAck } from "@/notifications-core/src/local-ack-gate";
import {
  browserLocalAckedStore,
  type LocalAckedStore,
} from "@/notifications-core/src/local-acked-store";
import type { NotificationInboxItem } from "@/lib/models/notifications-types";

/** Same cap as `POST /notifications/local-ack` (and the inbox page size). */
export const LOCAL_ACK_BATCH_MAX = 100;

const LOCAL_ACK_LOCK = "wgw-notifications/local-ack";

/** A tab whose ack request hangs must not keep the others from acking. */
const LOCAL_ACK_LOCK_MAX_WAIT_MS = 15_000;

export type LocalAckDeps = {
  /** Runs `task` while no other tab of this browser runs a local-ack flush. */
  runExclusive: (task: () => Promise<void>) => Promise<void>;
  /** Rows this browser already acked, shared by its tabs and kept across reloads. */
  acked: LocalAckedStore;
};

export function defaultLocalAckDeps(): LocalAckDeps {
  return {
    runExclusive: (task) =>
      withCrossTabLock(LOCAL_ACK_LOCK, task, { maxWaitMs: LOCAL_ACK_LOCK_MAX_WAIT_MS }),
    acked: browserLocalAckedStore(),
  };
}

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
 * usual.
 *
 * A load costs at most one request whatever the unread count (#1826): every
 * row not yet acked goes in one `POST /notifications/local-ack`, and acked
 * ids are remembered for the browser ({@link LocalAckedStore}), so a reload or
 * a second tab sends nothing for them. Tabs flush one at a time under a Web
 * Lock and re-read that list once they hold it, so two visible tabs never send
 * the same rows. Returns the callback the inbox calls with each fresh unread
 * list.
 */
export function useNotificationsLocalAck(
  createDeps: () => LocalAckDeps = defaultLocalAckDeps,
): (unread: readonly NotificationInboxItem[]) => void {
  const callStore = useMeetCallStoreContext();
  const unreadRef = useRef<readonly NotificationInboxItem[]>([]);
  const depsRef = useRef<LocalAckDeps | null>(null);
  depsRef.current ??= createDeps();
  const flushingRef = useRef(false);
  /** A new list or visibility change arrived during a flush: run once more after it. */
  const againRef = useRef(false);

  const allowed = useCallback(
    () => canLocalAck(currentVisibility(), inMeetCall(callStore)),
    [callStore],
  );

  /** Acks what is pending; false when a request failed (retried on the next poll). */
  const flushOnce = useCallback(async (): Promise<boolean> => {
    const deps = depsRef.current;
    if (!deps) return true;
    const pending = (acked: ReadonlySet<string>) =>
      unreadRef.current.map((row) => row.id).filter((id) => !acked.has(id));
    if (pending(deps.acked.read()).length === 0) return true;
    try {
      await deps.runExclusive(async () => {
        // Another tab may have acked these while this one waited for the lock.
        const ids = pending(deps.acked.read());
        for (let start = 0; start < ids.length && allowed(); start += LOCAL_ACK_BATCH_MAX) {
          const batch = ids.slice(start, start + LOCAL_ACK_BATCH_MAX);
          await ackLocalNotifications(batch);
          deps.acked.add(batch);
        }
      });
      return true;
    } catch {
      return false;
    }
  }, [allowed]);

  const flush = useCallback(() => {
    if (!allowed()) return;
    if (flushingRef.current) {
      againRef.current = true;
      return;
    }
    flushingRef.current = true;
    void (async () => {
      try {
        let ok = true;
        do {
          againRef.current = false;
          ok = await flushOnce();
        } while (ok && againRef.current && allowed());
      } finally {
        againRef.current = false;
        flushingRef.current = false;
      }
    })();
  }, [allowed, flushOnce]);

  const trackUnread = useCallback(
    (unread: readonly NotificationInboxItem[]) => {
      unreadRef.current = unread;
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
