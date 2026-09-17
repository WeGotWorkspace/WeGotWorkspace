/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { PWA_NAVIGATE_FALLBACK_DENYLIST } from "./lib/offline/pwa-navigate-fallback-denylist";
import {
  resolveNotificationNavigateHref,
  WGW_NOTIFICATION_NAVIGATE_MESSAGE,
} from "./notifications-core/src/notification-click-navigate";
import { parseNotificationPushPayload } from "./notifications-core/src/parse-notification-push-payload";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// skipWaiting stays false in production: a new worker waits until existing tabs close.
precacheAndRoute(self.__WB_MANIFEST);
if (import.meta.env.PROD) {
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL("index.html"), {
      denylist: [...PWA_NAVIGATE_FALLBACK_DENYLIST],
    }),
  );
} else {
  // Dev SW exists for Web Push; skip SPA fallback so Vite HMR is not intercepted.
  void self.skipWaiting();
}
clientsClaim();

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let raw: unknown = null;
      try {
        raw = event.data ? event.data.json() : null;
      } catch {
        raw = null;
      }
      const parsed = parseNotificationPushPayload(raw);
      if (!parsed) return;
      await self.registration.showNotification(parsed.title, {
        body: parsed.body,
        tag: parsed.tag,
        data: { navigate: parsed.navigate },
        // Worker NotificationOptions include `renotify`; DOM lib in the app tsconfig does not.
        ...({ renotify: parsed.renotify } as NotificationOptions),
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = resolveNotificationNavigateHref(
    event.notification.data?.navigate,
    self.location.origin,
  );
  const path = new URL(href).pathname + new URL(href).search + new URL(href).hash;
  event.waitUntil(openOrFocusNotificationTarget(href, path));
});

async function openOrFocusNotificationTarget(href: string, path: string): Promise<WindowClient | null> {
  const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clientList) {
    if (!("focus" in client)) continue;
    client.postMessage({ type: WGW_NOTIFICATION_NAVIGATE_MESSAGE, navigate: path });
    return client.focus();
  }
  if (self.clients.openWindow) {
    return self.clients.openWindow(href);
  }
  return null;
}
