import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ackLocalNotification,
  ackNotification,
  listNotifications,
} from "@/lib/api/wgw/notifications";
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
import { formatNotificationCopy } from "@/notifications-core/src/format-notification-copy";
import {
  playInboxNotificationSound,
  readNotificationSoundMuted,
  shouldPlayInboxNotificationSound,
  writeNotificationSoundMuted,
} from "@/notifications-core/src/notification-inbox-sound";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";
import { shouldShowOsNotification } from "@/notifications-core/src/should-show-os-notification";
import { usePresenceStoreContext } from "@/presence-core/src/presence-provider";

export {
  NotificationsInboxValueProvider,
  useNotificationsInbox,
  type NotificationsInboxValue,
} from "@/notifications-core/src/notifications-inbox-context";

/** Inbox poll interval. Shared-hosting floor for a single install; keep below the 20s local-ack grace. */
export const NOTIFICATIONS_INBOX_POLL_MS = 15_000;

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

/**
 * Live JS (any window, including Meet and an installed PWA) local-acks so VAPID
 * is reserved for fully quit clients. Closing one tab is not closed.
 * OS toasts stay hidden-tab only — a focused surface already has the inbox.
 */
async function ackLiveInboxItem(item: NotificationInboxItem): Promise<void> {
  const visibility = typeof document === "undefined" ? "visible" : document.visibilityState;
  const permission = typeof Notification === "undefined" ? "denied" : Notification.permission;
  if (shouldShowOsNotification(visibility, permission)) {
    const copy = formatNotificationCopy(item);
    const toast = new Notification(copy.title, {
      body: copy.body ?? undefined,
      tag: item.tag ?? item.id,
      data: { navigate: item.navigate },
    });
    toast.onclick = () => {
      window.focus();
      goToNotificationNavigate(item.navigate);
    };
  }
  try {
    await ackLocalNotification(item.id);
  } catch {
    // Best-effort local ack so the VAPID sweep can skip.
  }
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
  /** Abort in-flight GETs so a slow poll cannot overwrite a newer hint refresh. */
  const refreshAbortRef = useRef<AbortController | null>(null);
  const hintRetryTimersRef = useRef<number[]>([]);
  const signedIn = signedInMember();

  const refresh = useCallback(async () => {
    if (!wgwHasAuthenticatedSession() || wgwIsGuestSession()) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    refreshAbortRef.current?.abort();
    const abort = new AbortController();
    refreshAbortRef.current = abort;
    try {
      // Bell tray is unread-only; mark-as-read removes rows from the next list.
      const payload = await listNotifications({ unread: true, signal: abort.signal });
      if (abort.signal.aborted) return;
      setItems(payload.list);
      setUnreadCount(payload.unreadCount);
      let sawNewAfterSeed = false;
      for (const item of payload.list) {
        if (seenRef.current.has(item.id)) continue;
        const afterSeed = seededRef.current;
        seenRef.current.add(item.id);
        void ackLiveInboxItem(item);
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
    } catch (error) {
      if (abort.signal.aborted) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      // Stay silent — tray is best-effort.
    }
  }, []);

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
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, NOTIFICATIONS_INBOX_POLL_MS);
    return () => {
      window.clearInterval(timer);
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
 * Polls the inbox, local-acks, and handles SW / OS clicks. The bell UI lives in
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
