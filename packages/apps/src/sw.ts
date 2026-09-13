/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { PWA_NAVIGATE_FALLBACK_DENYLIST } from "./lib/offline/pwa-navigate-fallback-denylist";
import { parseNotificationPushPayload } from "./notifications-core/src/parse-notification-push-payload";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// skipWaiting stays false: a new worker waits until existing tabs close (same as generateSW).
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [...PWA_NAVIGATE_FALLBACK_DENYLIST],
  }),
);
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
  const navigate =
    typeof event.notification.data?.navigate === "string" ? event.notification.data.navigate : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          void client.navigate(navigate);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(navigate);
      }
      return undefined;
    }),
  );
});
