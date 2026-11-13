// Production build: an app opened once reloads offline, and opening one app
// does not download the others (#1628). Runs on `vite preview` through
// `playwright.pwa.config.mjs`; the dev server registers no navigation route and
// no lazy-chunk cache, so the live tier cannot see this.
import { expect, test } from "./helpers/live-test";

const LAZY_ASSET_CACHE = "wgw-lazy-assets";
// App entry chunks; `calendar-<hash>.js` alone is shared code that Contacts imports.
const OTHER_APP_CHUNK =
  /\/assets\/(calendar-app|docs-app|wegotworkspace-meet-live-route)-[^/]*\.js$/;

test("Contacts reloads offline after one visit, and the precache holds no other app", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout: 60_000,
  });

  await page.goto("/contacts/all");
  await expect(page.getByPlaceholder("Search contacts...")).toBeVisible();
  // The offline copy of the list exists once the first download is done.
  await expect(page.getByRole("button", { name: "Refresh contacts" })).toBeEnabled({
    timeout: 60_000,
  });

  const cacheState = await page.evaluate(async (lazyName) => {
    const origin = location.origin;
    const lazy = await caches.open(lazyName);
    const lazyUrls = (await lazy.keys()).map((request) => request.url.replace(origin, ""));
    const precacheUrls: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.includes("precache")) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) precacheUrls.push(request.url.replace(origin, ""));
    }
    const loaded = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name.replace(origin, ""))
      .filter((url) => /^\/assets\/.+\.js$/.test(url.split("?")[0]!));
    return { lazyUrls, precacheUrls, loaded };
  }, LAZY_ASSET_CACHE);

  // Every script the Contacts route loaded is cached for offline use.
  expect(cacheState.loaded.length).toBeGreaterThan(0);
  for (const url of cacheState.loaded) {
    expect(
      cacheState.lazyUrls.concat(cacheState.precacheUrls).map((u) => u.split("?")[0]),
    ).toContain(url.split("?")[0]);
  }
  expect(cacheState.lazyUrls.some((url) => /\/assets\/.+\.js$/.test(url))).toBe(true);
  // Opening Contacts did not precache the other apps.
  expect(cacheState.precacheUrls.filter((url) => OTHER_APP_CHUNK.test(url))).toEqual([]);
  expect(cacheState.lazyUrls.filter((url) => OTHER_APP_CHUNK.test(url))).toEqual([]);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByPlaceholder("Search contacts...")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("Contacts opened first on a cold load reloads offline from the window's own copy", async ({
  page,
  context,
}) => {
  // First navigation of a fresh context: no worker yet, so the lazy chunks
  // load before it can see them and only `cacheLoadedLazyAssets` stores them.
  await page.goto("/contacts/all");
  await expect(page.getByPlaceholder("Search contacts...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh contacts" })).toBeEnabled({
    timeout: 60_000,
  });
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
    timeout: 60_000,
  });

  await expect
    .poll(
      () =>
        page.evaluate(async (lazyName) => {
          const origin = location.origin;
          const lazy = await caches.open(lazyName);
          const cached = new Set((await lazy.keys()).map((r) => new URL(r.url).pathname));
          const precached = new Set<string>();
          for (const name of await caches.keys()) {
            if (!name.includes("precache")) continue;
            for (const r of await (await caches.open(name)).keys()) {
              precached.add(new URL(r.url).pathname);
            }
          }
          return performance
            .getEntriesByType("resource")
            .map((entry) => new URL(entry.name, origin).pathname)
            .filter((p) => /^\/assets\/.+\.js$/.test(p) && !precached.has(p) && !cached.has(p));
        }, LAZY_ASSET_CACHE),
      { timeout: 30_000 },
    )
    .toEqual([]);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByPlaceholder("Search contacts...")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
