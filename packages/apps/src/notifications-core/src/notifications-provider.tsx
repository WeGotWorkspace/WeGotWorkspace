import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ackNotification, listNotifications } from "@/lib/api/wgw/notifications";
import { wgwHasAuthenticatedSession, wgwIsGuestSession } from "@/lib/api/wgw/http";
import { ensurePushPermissionAndSubscribe } from "@/notifications-core/src/ensure-push-subscription";
import {
  assignNotificationNavigate,
  notificationNavigateFromMessage,
} from "@/notifications-core/src/notification-click-navigate";
import {
  NotificationsInboxValueProvider,
  type NotificationsInboxValue,
} from "@/notifications-core/src/notifications-inbox-context";
import {
  playInboxNotificationSound,
  readNotificationSoundMuted,
  shouldPlayInboxNotificationSound,
  writeNotificationSoundMuted,
} from "@/notifications-core/src/notification-inbox-sound";
import type {
  NotificationInboxItem,
  NotificationInboxList,
} from "@/notifications-core/src/notifications-types";
import { useNotificationsInboxPush } from "@/notifications-core/src/use-notifications-inbox-push";
import { useNotificationsLocalAck } from "@/notifications-core/src/use-notifications-local-ack";
import { usePresenceStoreContext } from "@/presence-core/src/presence-provider";

export {
  NotificationsInboxValueProvider,
  useNotificationsInbox,
  type NotificationsInboxValue,
} from "@/notifications-core/src/notifications-inbox-context";

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
 * After a mesh notify-hint, re-GET again shortly in case the first response raced
 * an in-flight poll or a momentarily empty replica view. Kept short so the bell
 * still feels instant.
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
  const signedIn = signedInMember();
  const trackUnreadForLocalAck = useNotificationsLocalAck();

  const applyPayload = useCallback(
    (payload: NotificationInboxList) => {
      setItems(payload.list);
      setUnreadCount(payload.unreadCount);
      trackUnreadForLocalAck(payload.list);
      let sawNewAfterSeed = false;
      for (const item of payload.list) {
        if (seenRef.current.has(item.id)) continue;
        const afterSeed = seededRef.current;
        seenRef.current.add(item.id);
        if (afterSeed) sawNewAfterSeed = true;
      }
      seededRef.current = true;
      if (sawNewAfterSeed) {
        setUnreadArrivalNonce((n) => n + 1);
        const visibility = typeof document === "undefined" ? "visible" : document.visibilityState;
        if (shouldPlayInboxNotificationSound(visibility, soundMutedRef.current)) {
          playInboxNotificationSound();
        }
      }
    },
    [trackUnreadForLocalAck],
  );

  const highestSharedMarkerRef = useRef<bigint | null>(null);

  const show = useCallback(
    (seq: number, payload: NotificationInboxList) => {
      if (seq <= shownSeqRef.current) return;
      shownSeqRef.current = seq;
      shownRef.current = payload;
      applyPayload(payload);
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
  }, [show]);

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
    (payload: NotificationInboxList, state: string) => {
      // Markers are decimal strings; an older share must not replace newer rows.
      const marker = /^\d+$/.test(state) ? BigInt(state) : null;
      if (marker !== null) {
        const highest = highestSharedMarkerRef.current;
        if (highest !== null && marker < highest) return;
        highestSharedMarkerRef.current = marker;
      }
      refreshAbortRef.current?.abort();
      shownSeqRef.current = fetchSeqRef.current;
      shownRef.current = payload;
      applyPayload(payload);
    },
    [applyPayload],
  );

  const pushConnected = useNotificationsInboxPush({ signedIn, fetchForPush, apply: applyShared });
  const pollMs = pushConnected ? NOTIFICATIONS_INBOX_PUSH_POLL_MS : NOTIFICATIONS_INBOX_POLL_MS;

  const refreshFromNotifyHint = useCallback(() => {
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
    if (!presenceStore) return;
    // Open-tab acceleration: principal mesh wake → re-GET inbox (server remains SoT).
    return presenceStore.subscribeNotifyHint(() => {
      refreshFromNotifyHint();
    });
  }, [presenceStore, refreshFromNotifyHint]);

  useEffect(() => {
    const worker = navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const path = notificationNavigateFromMessage(event.data);
      if (!path) return;
      window.focus();
      goToNotificationNavigate(path);
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, []);

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

  const onOpenItem = useCallback(async (item: NotificationInboxItem) => {
    setItems((prev) => prev.filter((row) => row.id !== item.id));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await ackNotification(item.id);
    } catch {
      // Continue to navigate even if ack fails; next unread poll reconciles.
    }
    goToNotificationNavigate(item.navigate);
  }, []);

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
    setItems([]);
    setUnreadCount(0);
    await Promise.all(ids.map((id) => ackNotification(id).catch(() => undefined)));
  }, [items]);

  const markReadWhere = useCallback(
    async (match: (item: NotificationInboxItem) => boolean) => {
      const matched = items.filter(match);
      if (matched.length === 0) return;
      const ids = new Set(matched.map((item) => item.id));
      setItems((prev) => prev.filter((row) => !ids.has(row.id)));
      setUnreadCount((prev) => Math.max(0, prev - matched.length));
      await Promise.all([...ids].map((id) => ackNotification(id).catch(() => undefined)));
    },
    [items],
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
 * {@link useNotificationsInboxPush}), local-acks from a visible window or a Meet call, and handles
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
