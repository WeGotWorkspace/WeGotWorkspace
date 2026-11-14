import { useCallback, useEffect, useMemo, useRef } from "react";
import { isApiError } from "@/lib/api/api-error";
import { ackNotifications } from "@/lib/api/wgw/notifications";
import type { NotificationInboxList } from "@/lib/models/notifications-types";

/** Same cap as `POST /notifications/ack` (and the inbox page size). */
export const READ_ACK_BATCH_MAX = 100;

/** Pause before each retry of a failed read ack; after the last, the next inbox refresh retries. */
export const READ_ACK_RETRY_MS: readonly number[] = [2_000, 10_000, 30_000];

/**
 * How long a confirmed row stays hidden: an inbox GET that started before the
 * ack landed can still list it as unread.
 */
export const READ_ACK_SETTLE_MS = 30_000;

export type ReadAckDeps = {
  send: (ids: readonly string[]) => Promise<void>;
  now: () => number;
};

const defaultDeps: ReadAckDeps = { send: (ids) => ackNotifications(ids), now: () => Date.now() };

export type NotificationsReadAck = {
  /**
   * Mark rows read on the server: one request per {@link READ_ACK_BATCH_MAX}
   * ids, however many rows. Resolves once the first try is done and never
   * rejects; a failure is retried (see {@link READ_ACK_RETRY_MS}).
   */
  markRead: (ids: Iterable<string>) => Promise<void>;
  /** The list without rows marked read here that the server may still list as unread. */
  hideMarkedRead: (payload: NotificationInboxList) => NotificationInboxList;
  /** Send what is still unconfirmed. The inbox calls it on every refresh. */
  retryUnconfirmed: () => void;
};

/**
 * A failure the server will answer the same way next time: a malformed body
 * or a session that ended. Network errors, 408, 429 and 5xx are retried.
 */
function isPermanent(error: unknown): boolean {
  if (!isApiError(error)) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

/**
 * Marks inbox rows read in batches (#2154). Opening a Meet channel with 32
 * unread mentions used to send 32 `POST /notifications/{id}/ack` at once and
 * drop every failure; on a server with five PHP workers that kept chat from
 * loading. Now every row the user marked read waits in one queue: it goes out
 * in one `POST /notifications/ack`, a failure stays queued and is retried with
 * a backoff and on the next inbox refresh, and until the server confirms it
 * the row stays out of the tray, so it does not pop back as unread.
 */
export function useNotificationsReadAck(deps: ReadAckDeps = defaultDeps): NotificationsReadAck {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  /** Marked read here; not confirmed by the server yet. */
  const unconfirmedRef = useRef(new Set<string>());
  /** Confirmed rows and when, hidden for {@link READ_ACK_SETTLE_MS}. */
  const settledRef = useRef(new Map<string, number>());
  const flushingRef = useRef<Promise<void> | null>(null);
  const againRef = useRef(false);
  const failuresRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  const clearRetry = () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  /** Sends every unconfirmed id once; false when a request failed. */
  const sendOnce = useCallback(async (): Promise<boolean> => {
    const ids = [...unconfirmedRef.current];
    for (let start = 0; start < ids.length; start += READ_ACK_BATCH_MAX) {
      const batch = ids.slice(start, start + READ_ACK_BATCH_MAX);
      try {
        await depsRef.current.send(batch);
      } catch (error: unknown) {
        if (!isPermanent(error)) {
          console.warn("[notifications] mark as read failed; will retry", error);
          return false;
        }
        // Retrying cannot help; the next inbox list shows the rows as they are.
        console.warn("[notifications] mark as read refused", error);
        for (const id of batch) unconfirmedRef.current.delete(id);
        continue;
      }
      const at = depsRef.current.now();
      for (const id of batch) {
        unconfirmedRef.current.delete(id);
        settledRef.current.set(id, at);
      }
    }
    return true;
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (flushingRef.current) {
      againRef.current = true;
      return flushingRef.current;
    }
    clearRetry();
    const run = (async () => {
      let ok: boolean;
      do {
        againRef.current = false;
        ok = await sendOnce();
      } while (ok && againRef.current);
      if (ok) {
        failuresRef.current = 0;
        return;
      }
      const delay = READ_ACK_RETRY_MS[failuresRef.current];
      failuresRef.current += 1;
      if (delay !== undefined) {
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void flush();
        }, delay);
      }
    })().finally(() => {
      flushingRef.current = null;
    });
    flushingRef.current = run;
    return run;
  }, [sendOnce]);

  const markRead = useCallback(
    async (ids: Iterable<string>): Promise<void> => {
      let added = false;
      for (const id of ids) {
        if (unconfirmedRef.current.has(id)) continue;
        unconfirmedRef.current.add(id);
        added = true;
      }
      if (!added) return;
      // New rows start a fresh backoff.
      failuresRef.current = 0;
      await flush();
    },
    [flush],
  );

  const hideMarkedRead = useCallback((payload: NotificationInboxList): NotificationInboxList => {
    const now = depsRef.current.now();
    for (const [id, at] of settledRef.current) {
      if (now - at > READ_ACK_SETTLE_MS) settledRef.current.delete(id);
    }
    const hidden = (id: string) => unconfirmedRef.current.has(id) || settledRef.current.has(id);
    const list = payload.list.filter((row) => !hidden(row.id));
    const dropped = payload.list.length - list.length;
    if (dropped === 0) return payload;
    return { ...payload, list, unreadCount: Math.max(0, payload.unreadCount - dropped) };
  }, []);

  const retryUnconfirmed = useCallback(() => {
    if (
      unconfirmedRef.current.size === 0 ||
      flushingRef.current ||
      retryTimerRef.current !== null
    ) {
      return;
    }
    void flush();
  }, [flush]);

  useEffect(() => clearRetry, []);

  return useMemo(
    () => ({ markRead, hideMarkedRead, retryUnconfirmed }),
    [markRead, hideMarkedRead, retryUnconfirmed],
  );
}
