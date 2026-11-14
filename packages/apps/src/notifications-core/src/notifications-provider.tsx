import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { listNotifications } from "@/lib/api/wgw/notifications";
import { wgwHasAuthenticatedSession, wgwIsGuestSession } from "@/lib/api/wgw/http";
import { ensurePushPermissionAndSubscribe } from "@/notifications-core/src/ensure-push-subscription";
import {
  assignNotificationNavigate,
  notificationNavigateFromMessage,
} from "@/lib/notifications/notification-click-navigate";
import {
  NotificationsInboxValueProvider,
  type NotificationsInboxValue,
} from "@/lib/notifications/notifications-inbox-context";
import {
  playInboxNotificationSound,
  readNotificationSoundMuted,
  shouldPlayInboxNotificationSound,
  writeNotificationSoundMuted,
} from "@/notifications-core/src/notification-inbox-sound";
import type {
  NotificationInboxItem,
  NotificationInboxList,
} from "@/lib/models/notifications-types";
import { pushedItemFromMessage } from "@/notifications-core/src/push-delivery";
import {
  dropPushedItems,
  holdPushedItem,
  mergePushedItems,
  type PushedInboxItems,
} from "@/notifications-core/src/pushed-inbox-items";
import { useNotificationsInboxPush } from "@/notifications-core/src/use-notifications-inbox-push";
import { useNotificationsLocalAck } from "@/notifications-core/src/use-notifications-local-ack";
import { useNotificationsReadAck } from "@/notifications-core/src/use-notifications-read-ack";
import { useNotificationToasts } from "@/notifications-core/src/use-notification-toasts";
import { usePresenceStoreContext } from "@/presence-core/src/presence-provider";

export {
  NotificationsInboxValueProvider,
  useNotificationsInbox,
  type NotificationsInboxValue,
} from "@/lib/notifications/notifications-inbox-context";

/**
 * Inbox poll interval while push is down. Shared-hosting floor for a single
 * install; keep below the 20s local-ack grace.
 */
export const NOTIFICATIONS_INBOX_POLL_MS = 15_000;

/**
 * Fallback poll while the JMAP push stream is connected: a `Notification`
 * push fetches the inbox at once, so the poll only catches a lost push.
 */
export const NOTIFICATIONS_INBOX_PUSH_POLL_MS = 60_000;

/**
 * After a mesh `check-now` while push is down, re-GET again shortly in case the
 * first response raced an in-flight poll or a momentarily empty replica view.
 * Kept short so the bell still feels instant.
 */
export const NOTIFICATIONS_HINT_RETRY_MS = [300, 1_200] as const;

function signedInMember(): boolean {
  return wgwHasAuthenticatedSession() && !wgwIsGuestSession();
}

function goToNotificationNavigate(path: string): void {
  assignNotificationNavigate(path, signedInMember(), (href) => {
    window.location.assign(href);
  });
}

function useNotificationsInboxController(): NotificationsInboxValue | null {
  const [items, setItems] = useState<NotificationInboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted",
  );
  const [soundMuted, setSoundMuted] = useState(() => readNotificationSoundMuted());
  const [unreadArrivalNonce, setUnreadArrivalNonce] = useState(0);
  const seenRef = useRef<Set<string>>(new Set());
  /** First successful list seeds seen ids without chime/pulse (existing unread). */
  const seededRef = useRef(false);
  const soundMutedRef = useRef(soundMuted);
  soundMutedRef.current = soundMuted;
  /** Abort in-flight refreshes; a newer one replaces them. */
  const refreshAbortRef = useRef<AbortController | null>(null);
  /**
   * Every inbox GET gets a number; a response is shown only when no GET that
   * started later was shown first, so a slow poll cannot overwrite newer rows.
   */
  const fetchSeqRef = useRef(0);
  const shownSeqRef = useRef(0);
  const shownRef = useRef<NotificationInboxList | null>(null);
  const hintRetryTimersRef = useRef<number[]>([]);
  /** Rows the service worker posted that no inbox list carried yet (#1670). */
  const pushedRef = useRef<PushedInboxItems>(new Map());
  const signedIn = signedInMember();
  const trackUnreadForLocalAck = useNotificationsLocalAck();
  const readAck = useNotificationsReadAck();

  /** A popover row or toast click: mark the row read, then open it. */
  const onOpenItem = useCallback(
    async (item: NotificationInboxItem) => {
      pushedRef.current = dropPushedItems(pushedRef.current, [item.id]);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      // Never rejects: a failed ack is retried, and the row stays out of the tray.
      await readAck.markRead([item.id]);
      goToNotificationNavigate(item.navigate);
    },
    [readAck],
  );

  const offerToasts = useNotificationToasts(onOpenItem);

  const applyPayload = useCallback(
    (fromServer: NotificationInboxList) => {
      const merged = mergePushedItems(fromServer, pushedRef.current, Date.now());
      pushedRef.current = merged.pending;
      // Rows marked read here stay out until the server has them as read.
      const payload = readAck.hideMarkedRead(merged.payload);
      setItems(payload.list);
      setUnreadCount(payload.unreadCount);
      trackUnreadForLocalAck(payload.list);
      const fresh: NotificationInboxItem[] = [];
      for (const item of payload.list) {
        if (seenRef.current.has(item.id)) continue;
        seenRef.current.add(item.id);
        if (seededRef.current) fresh.push(item);
      }
      seededRef.current = true;
      if (fresh.length > 0) {
        offerToasts(fresh);
        setUnreadArrivalNonce((n) => n + 1);
        const visibility = typeof document === "undefined" ? "visible" : document.visibilityState;
        if (shouldPlayInboxNotificationSound(visibility, soundMutedRef.current)) {
          playInboxNotificationSound();
        }
      }
    },
    [trackUnreadForLocalAck, offerToasts, readAck],
  );

  const show = useCallback(
    (seq: number, payload: NotificationInboxList) => {
      if (seq <= shownSeqRef.current) return;
      shownSeqRef.current = seq;
      shownRef.current = payload;
      applyPayload(payload);
    },
    [applyPayload],
  );

  /**
   * A row the service worker posted from a Web Push. Shown at once and kept
   * until an inbox list carries it; a row already seen is ignored, so it never
   * chimes twice.
   */
  const applyPushedItem = useCallback(
    (item: NotificationInboxItem) => {
      if (seenRef.current.has(item.id)) return;
      pushedRef.current = holdPushedItem(pushedRef.current, item, Date.now());
      applyPayload(shownRef.current ?? { list: [], unreadCount: 0 });
    },
    [applyPayload],
  );

  /** Poll, hint and visibility refetch: fetch and show the unread inbox. */
  const refresh = useCallback(async (): Promise<void> => {
    if (!wgwHasAuthenticatedSession() || wgwIsGuestSession()) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    readAck.retryUnconfirmed();
    refreshAbortRef.current?.abort();
    const abort = new AbortController();
    refreshAbortRef.current = abort;
    const seq = ++fetchSeqRef.current;
    try {
      // Bell tray is unread-only; mark-as-read removes rows from the next list.
      const payload = await listNotifications({ unread: true, signal: abort.signal });
      if (!abort.signal.aborted) show(seq, payload);
    } catch {
      // Stay silent — tray is best-effort.
    }
  }, [show, readAck]);

  /**
   * The fetch for a pushed state. Not aborted by a refresh that starts
   * meanwhile. Resolves the newest rows shown after it (its own, or those of
   * a GET that started later), or null when it failed.
   */
  const fetchForPush = useCallback(async (): Promise<NotificationInboxList | null> => {
    if (!wgwHasAuthenticatedSession() || wgwIsGuestSession()) return null;
    const seq = ++fetchSeqRef.current;
    try {
      const payload = await listNotifications({ unread: true });
      show(seq, payload);
      return shownRef.current ?? payload;
    } catch {
      return null;
    }
  }, [show]);

  /** Rows the stream tab fetched on push: newer than any GET still in flight here. */
  const applyShared = useCallback(
    (payload: NotificationInboxList) => {
      refreshAbortRef.current?.abort();
      shownSeqRef.current = fetchSeqRef.current;
      shownRef.current = payload;
      applyPayload(payload);
    },
    [applyPayload],
  );

  const pushConnected = useNotificationsInboxPush({ signedIn, fetchForPush, apply: applyShared });
  const pollMs = pushConnected ? NOTIFICATIONS_INBOX_PUSH_POLL_MS : NOTIFICATIONS_INBOX_POLL_MS;

  const refreshFromCheckNow = useCallback(() => {
    for (const timer of hintRetryTimersRef.current) {
      window.clearTimeout(timer);
    }
    hintRetryTimersRef.current = [];
    void refresh();
    hintRetryTimersRef.current = NOTIFICATIONS_HINT_RETRY_MS.map((delay) =>
      window.setTimeout(() => {
        void refresh();
      }, delay),
    );
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [refresh, pollMs]);

  useEffect(() => {
    void refresh();
    // Hidden tabs poll late (timer throttling). On becoming visible, re-fetch so
    // rows that arrived meanwhile are acked within the local-ack grace.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      refreshAbortRef.current?.abort();
      for (const retry of hintRetryTimersRef.current) {
        window.clearTimeout(retry);
      }
      hintRetryTimersRef.current = [];
    };
  }, [refresh]);

  const presenceStore = usePresenceStoreContext();
  useEffect(() => {
    // While push is connected, a peer's `check-now` wakes the push stream instead,
    // and the `Notification` state brings the inbox (#1662).
    if (!presenceStore || pushConnected) return;
    return presenceStore.subscribeCheckNow(refreshFromCheckNow);
  }, [presenceStore, pushConnected, refreshFromCheckNow]);

  useEffect(() => {
    const worker = navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const pushed = pushedItemFromMessage(event.data);
      if (pushed) {
        applyPushedItem(pushed);
        return;
      }
      const path = notificationNavigateFromMessage(event.data);
      if (!path) return;
      window.focus();
      goToNotificationNavigate(path);
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, [applyPushedItem]);

  useEffect(() => {
    if (!signedIn) return;
    void ensurePushPermissionAndSubscribe().then((enabled) => {
      setPushEnabled(enabled);
    });
    // Safari often refuses PushManager.subscribe outside a user gesture even
    // after Notification.permission is granted (Meet PWA has no tray button).
    const retrySubscribe = () => {
      void ensurePushPermissionAndSubscribe().then((enabled) => {
        setPushEnabled(enabled);
      });
    };
    window.addEventListener("pointerdown", retrySubscribe, { once: true });
    return () => window.removeEventListener("pointerdown", retrySubscribe);
  }, [signedIn]);

  const onEnablePush = useCallback(() => {
    void ensurePushPermissionAndSubscribe().then((enabled) => {
      setPushEnabled(enabled);
    });
  }, []);

  const onToggleSoundMute = useCallback(() => {
    setSoundMuted((prev) => {
      const next = !prev;
      writeNotificationSoundMuted(next);
      return next;
    });
  }, []);

  const onMarkAllRead = useCallback(async () => {
    if (items.length === 0) return;
    const ids = items.map((item) => item.id);
    pushedRef.current = dropPushedItems(pushedRef.current, ids);
    setItems([]);
    setUnreadCount(0);
    await readAck.markRead(ids);
  }, [items, readAck]);

  const markReadWhere = useCallback(
    async (match: (item: NotificationInboxItem) => boolean) => {
      const matched = items.filter(match);
      if (matched.length === 0) return;
      const ids = new Set(matched.map((item) => item.id));
      pushedRef.current = dropPushedItems(pushedRef.current, ids);
      setItems((prev) => prev.filter((row) => !ids.has(row.id)));
      setUnreadCount((prev) => Math.max(0, prev - matched.length));
      await readAck.markRead(ids);
    },
    [items, readAck],
  );

  return useMemo((): NotificationsInboxValue | null => {
    if (!signedIn) return null;
    return {
      items,
      unreadCount,
      onOpenItem,
      onMarkAllRead,
      markReadWhere,
      onEnablePush,
      pushEnabled,
      soundMuted,
      onToggleSoundMute,
      unreadArrivalNonce,
    };
  }, [
    signedIn,
    items,
    unreadCount,
    onOpenItem,
    onMarkAllRead,
    markReadWhere,
    onEnablePush,
    pushEnabled,
    soundMuted,
    onToggleSoundMute,
    unreadArrivalNonce,
  ]);
}

/**
 * Keeps the inbox current (on push, with a slower poll as fallback; see
 * {@link useNotificationsInboxPush}), local-acks from a visible window or a Meet call, shows a
 * new row as a toast in the tab the user is looking at ({@link useNotificationToasts}), and handles
 * service-worker notification clicks. Hidden windows show no OS toast of their
 * own: the service-worker push is the only OS notification path. The bell UI lives in
 * AppSidebar — not a viewport overlay — so Meet (which shares that sidebar)
 * gets the same safe slot.
 */
export function NotificationsProvider({ children }: { children?: ReactNode }): ReactElement {
  const value = useNotificationsInboxController();
  return (
    <NotificationsInboxValueProvider value={value}>{children}</NotificationsInboxValueProvider>
  );
}

/** Inbox side effects without wrapping a tree (tests). Tray UI is in AppSidebar. */
export function NotificationsHost(): ReactElement {
  return <NotificationsProvider />;
}
