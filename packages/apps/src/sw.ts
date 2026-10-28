/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { PWA_NAVIGATE_FALLBACK_DENYLIST } from "./lib/offline/pwa-navigate-fallback-denylist";
import {
  notificationClickTarget,
  pickNotificationClient,
  WGW_NOTIFICATION_NAVIGATE_MESSAGE,
} from "./notifications-core/src/notification-click-navigate";
import { parseNotificationPushPayload } from "./notifications-core/src/parse-notification-push-payload";
import {
  handlePushSubscriptionChange,
  serviceWorkerApiBaseUrl,
} from "./notifications-core/src/push-subscription-change";
import { readPushScopes } from "./notifications-core/src/push-scope";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

/** Not in the TypeScript webworker lib yet. */
type PushSubscriptionChangeEvent = ExtendableEvent & {
  readonly oldSubscription?: PushSubscription | null;
  readonly newSubscription?: PushSubscription | null;
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
        data: { navigate: parsed.navigate, scope: parsed.scope },
        // Worker NotificationOptions include `renotify`; DOM lib in the app tsconfig does not.
        ...({ renotify: parsed.renotify } as NotificationOptions),
      });
    })(),
  );
});

// The browser rotated or expired the subscription: register the new endpoint now,
// not on the next app open. See docs/architecture/suite-notify.md.
self.addEventListener("pushsubscriptionchange", (event) => {
  const change = event as PushSubscriptionChangeEvent;
  change.waitUntil(
    handlePushSubscriptionChange(
      {
        oldSubscription: change.oldSubscription ?? null,
        newSubscription: change.newSubscription ?? null,
      },
      {
        apiBaseUrl: serviceWorkerApiBaseUrl(
          import.meta.env.VITE_WGW_API_BASE_URL as string | undefined,
        ),
        fetch: (input, init) => self.fetch(input, init),
        pushManager: self.registration.pushManager,
        locks: self.navigator.locks ?? null,
        readScopes: () => readPushScopes(self.indexedDB),
      },
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { navigate?: unknown; scope?: unknown } | null;
  // Open inside the app that received the push (#1606); `/` for older notifications.
  const target = notificationClickTarget(data?.navigate, data?.scope, self.location.origin);
  event.waitUntil(openOrFocusNotificationTarget(target));
});

async function openOrFocusNotificationTarget(
  target: ReturnType<typeof notificationClickTarget>,
): Promise<WindowClient | null> {
  const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const windows = clientList.filter((client): client is WindowClient => "focus" in client);
  const client = pickNotificationClient(windows, target.scope);
  if (client) {
    client.postMessage({ type: WGW_NOTIFICATION_NAVIGATE_MESSAGE, navigate: target.path });
    return client.focus();
  }
  if (self.clients.openWindow) {
    return self.clients.openWindow(target.href);
  }
  return null;
}
