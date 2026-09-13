import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ackLocalNotification,
  ackNotification,
  fetchVapidPublicKey,
  listNotifications,
  subscribePush,
} from "@/lib/api/wgw/notifications";
import { wgwHasAuthenticatedSession, wgwIsGuestSession } from "@/lib/api/wgw/http";
import { NotificationInboxTray } from "@/notifications-core/src/notification-inbox-tray";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";
import { shouldShowOsNotification } from "@/notifications-core/src/should-show-os-notification";

const POLL_MS = 30_000;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function maybeOsNotify(item: NotificationInboxItem): Promise<void> {
  const visibility = typeof document === "undefined" ? "visible" : document.visibilityState;
  const permission = typeof Notification === "undefined" ? "denied" : Notification.permission;
  if (!shouldShowOsNotification(visibility, permission)) return;
  new Notification(item.title, {
    body: item.body ?? undefined,
    tag: item.tag ?? item.id,
  });
  try {
    await ackLocalNotification(item.id);
  } catch {
    // Best-effort local ack so the VAPID sweep can skip.
  }
}

export function NotificationsHost() {
  const [items, setItems] = useState<NotificationInboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted",
  );
  const seenRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!wgwHasAuthenticatedSession() || wgwIsGuestSession()) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    try {
      const payload = await listNotifications();
      setItems(payload.list);
      setUnreadCount(payload.unreadCount);
      for (const item of payload.list) {
        if (item.readAt) continue;
        if (seenRef.current.has(item.id)) continue;
        seenRef.current.add(item.id);
        void maybeOsNotify(item);
      }
    } catch {
      // Stay silent — tray is best-effort.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const onOpenItem = useCallback(async (item: NotificationInboxItem) => {
    try {
      await ackNotification(item.id);
    } catch {
      // Continue to navigate even if ack fails.
    }
    window.location.assign(item.navigate);
  }, []);

  const onEnablePush = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setPushEnabled(permission === "granted");
    if (permission !== "granted" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }
    try {
      const key = await fetchVapidPublicKey();
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      await subscribePush(subscription.toJSON());
    } catch {
      // Permission granted is enough for the in-app Notification API.
    }
  }, []);

  if (!wgwHasAuthenticatedSession() || wgwIsGuestSession()) {
    return null;
  }

  return (
    <div className="notification-inbox-host">
      <NotificationInboxTray
        items={items}
        unreadCount={unreadCount}
        onOpenItem={onOpenItem}
        onEnablePush={onEnablePush}
        pushEnabled={pushEnabled}
      />
    </div>
  );
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <NotificationsHost />
    </>
  );
}
