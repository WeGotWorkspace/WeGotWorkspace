/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { LAZY_ASSET_CACHE } from "./lib/offline/cache-loaded-lazy-assets";
import {
  isLazyAssetRequest,
  LAZY_ASSETS_LIST,
  planLazyAssetSync,
} from "./lib/offline/precache-shell";
import { PWA_NAVIGATE_FALLBACK_DENYLIST } from "./lib/offline/pwa-navigate-fallback-denylist";
import {
  notificationClickTarget,
  pickNotificationClient,
  WGW_NOTIFICATION_NAVIGATE_MESSAGE,
} from "./notifications-core/src/notification-click-navigate";
import { parseNotificationPushPayload } from "./notifications-core/src/parse-notification-push-payload";
import {
  pushDeliveryPlan,
  WGW_NOTIFICATION_PUSHED_MESSAGE,
} from "./notifications-core/src/push-delivery";
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
const precacheManifest = self.__WB_MANIFEST;
precacheAndRoute(precacheManifest);
if (import.meta.env.PROD) {
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL("index.html"), {
      denylist: [...PWA_NAVIGATE_FALLBACK_DENYLIST],
    }),
  );
  // Lazy app chunks are not precached: keep one when its route first fetches it,
  // so an app already opened reloads offline. Hashed names never change content.
  registerRoute(
    ({ url }) => isLazyAssetRequest(url, self.location.origin),
    async ({ request }) => {
      const cache = await caches.open(LAZY_ASSET_CACHE);
      // The window stored the file without an Origin header, a module script sends one:
      // the response says `Vary: Origin`, which must not turn that into a miss.
      const hit = await cache.match(request, { ignoreVary: true });
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) {
        try {
          await cache.put(request, response.clone());
        } catch {
          // Quota or storage error: still return the network response.
        }
      }
      return response;
    },
  );
} else {
  // Dev SW exists for Web Push; skip SPA fallback so Vite HMR is not intercepted.
  void self.skipWaiting();
}
clientsClaim();

if (import.meta.env.PROD) {
  self.addEventListener("install", (event) => {
    event.waitUntil(prepareLazyAssets());
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(dropStaleLazyAssets());
  });
}

const NEXT_LAZY_LIST_KEY = "/.wgw-lazy-next";

function assetPath(url: string): string {
  return new URL(url, self.location.origin).pathname;
}

async function cachedLazyPaths(cache: Cache): Promise<string[]> {
  return (await cache.keys())
    .map((request) => assetPath(request.url))
    .filter((path) => path.startsWith("/assets/"));
}

/**
 * Install: remember which lazy chunks this build requests, and download this
 * build's version of every cached chunk that changed, so an app opened once
 * still opens offline after the deploy. Best effort: install never fails on it.
 */
async function prepareLazyAssets(): Promise<void> {
  try {
    const listResponse = await fetch(new URL(`/${LAZY_ASSETS_LIST}`, self.location.origin).href, {
      cache: "no-store",
    });
    if (!listResponse.ok) return;
    const next = ((await listResponse.json()) as unknown[]).filter(
      (path): path is string => typeof path === "string",
    );
    const cache = await caches.open(LAZY_ASSET_CACHE);
    await cache.put(
      new Request(new URL(NEXT_LAZY_LIST_KEY, self.location.origin).href),
      new Response(JSON.stringify(next)),
    );
    const plan = planLazyAssetSync(await cachedLazyPaths(cache), next);
    await Promise.all(
      plan.fetch.map(async (path) => {
        try {
          const response = await fetch(path);
          if (response.ok) await cache.put(path, response);
        } catch {
          // The route handler caches the chunk when it is first requested.
        }
      }),
    );
  } catch {
    // Offline or storage error: activation then keeps the cache as it is.
  }
}

/** Activate: delete only the cached chunks the new build does not request. */
async function dropStaleLazyAssets(): Promise<void> {
  const cache = await caches.open(LAZY_ASSET_CACHE);
  const stored = await cache.match(new URL(NEXT_LAZY_LIST_KEY, self.location.origin).href);
  if (!stored) return;
  const next = (await stored.json()) as string[];
  const plan = planLazyAssetSync(await cachedLazyPaths(cache), next);
  const stale = new Set(plan.delete);
  for (const request of await cache.keys()) {
    if (stale.has(assetPath(request.url))) await cache.delete(request);
  }
}

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
