/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { PWA_NAVIGATE_FALLBACK_DENYLIST } from "./lib/offline/core/pwa-navigate-fallback-denylist";
import {
  notificationClickTarget,
  pickNotificationClient,
  WGW_NOTIFICATION_NAVIGATE_MESSAGE,
} from "./lib/notifications/notification-click-navigate";
import { parseNotificationPushPayload } from "./notifications-core/src/parse-notification-push-payload";
import {
  pushDeliveryPlan,
  WGW_NOTIFICATION_PUSHED_MESSAGE,
} from "./notifications-core/src/push-delivery";
import {
  handlePushSubscriptionChange,
  serviceWorkerApiBaseUrl,
} from "./notifications-core/src/push-subscription-change";
import { readPushScopes } from "./lib/notifications/push-scope";
import {
  classifyRequest,
  DEFAULT_GOVERNOR_OPTIONS,
  isGovernedClass,
  isMeetLaneSignal,
  RequestGovernor,
  TRAFFIC_CLASS_HEADER,
  WGW_MEET_LANE_MESSAGE,
} from "./lib/traffic/request-governor";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

/** Not in the TypeScript webworker lib yet. */
type PushSubscriptionChangeEvent = ExtendableEvent & {
  readonly oldSubscription?: PushSubscription | null;
  readonly newSubscription?: PushSubscription | null;
};

// skipWaiting stays false in production: a new worker waits until existing tabs close.
// Icons and manifests carry `?v=` (cache bust); without ignoring it every app
// switch fetched them from the host instead of the precache (shared hosting budget).
precacheAndRoute(self.__WB_MANIFEST, {
  ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/],
});
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

// Shared hosting traffic budget (#2291): every tab's API requests pass one
// governor. Polls wait their turn, session reads are shared, everything else
// goes on natively (no respondWith); a write drops the shared answers.
const governorApiPrefix = new URL(
  serviceWorkerApiBaseUrl(import.meta.env.VITE_WGW_API_BASE_URL as string | undefined),
  self.location.origin,
).pathname.replace(/\/$/, "");
const governor = new RequestGovernor({
  ...DEFAULT_GOVERNOR_OPTIONS,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  fetch: (request) => self.fetch(request),
});
// Meet call setup (#2419): the page tells the worker when a call joins,
// negotiates or ends; the governor opens and closes the signaling lane.
self.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown; signal?: unknown } | null;
  if (data?.type !== WGW_MEET_LANE_MESSAGE || !isMeetLaneSignal(data.signal)) return;
  governor.signalMeetLane(data.signal);
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const kind = classifyRequest(
    event.request.method,
    url,
    governorApiPrefix,
    event.request.headers.get(TRAFFIC_CLASS_HEADER),
  );
  if (!kind) return;
  if (!isGovernedClass(kind)) {
    governor.observe(kind as "foreground" | "write");
    return;
  }
  event.respondWith(governor.handle(event.request, kind));
});

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
      // A visible window gets the row at once; where the browser allows it, it
      // then shows no OS notification (#1670, docs/architecture/notifications.md).
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const windows = clientList.filter(
        (client): client is WindowClient => "visibilityState" in client,
      );
      const plan = pushDeliveryPlan(windows, self.navigator.userAgent, parsed.item);
      for (const client of plan.postTo) {
        client.postMessage({ type: WGW_NOTIFICATION_PUSHED_MESSAGE, item: parsed.item });
      }
      if (!plan.showNotification) return;
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
