// Production build: app routes are lazy chunks (#1628), and the service worker
// still precaches every chunk, so after one online visit each app opens offline,
// including an app that was never opened. Runs on `vite preview` through
// `playwright.pwa.config.mjs`; the dev server registers no navigation route and
// an empty precache, so the live tier cannot see this.
import { expect, test } from "./helpers/live-test";

// App entry chunks; `calendar-<hash>.js` alone is shared code that Contacts imports.
const OTHER_APP_CHUNK =
  /\/assets\/(calendar-app|docs-app|wegotworkspace-meet-live-route)-[^/]*\.js$/;

test("one cold visit to Contacts: Contacts reloads offline, and Calendar opens offline too", async ({
  page,
  context,
}) => {
  // First navigation of a fresh context: no worker yet.
  await page.goto("/contacts/all");
  await expect(page.getByPlaceholder("Search contacts...")).toBeVisible();
  // The offline copy of the list exists once the first download is done.
  await expect(page.getByRole("button", { name: "Refresh contacts" })).toBeEnabled({
    timeout: 60_000,
  });
  // A worker controls the page only after install, and install finishes the precache.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
    timeout: 60_000,
  });

  const cacheState = await page.evaluate(async () => {
    const precached = new Set<string>();
    for (const name of await caches.keys()) {
      if (!name.includes("precache")) continue;
      for (const r of await (await caches.open(name)).keys()) {
        precached.add(new URL(r.url).pathname);
      }
    }
    const loaded = performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name, location.origin).pathname)
      .filter((p) => /^\/assets\/.+\.js$/.test(p));
    return { precached: [...precached], loaded };
  });

  // Opening Contacts loaded no other app's chunk...
  expect(cacheState.loaded.length).toBeGreaterThan(0);
  expect(cacheState.loaded.filter((p) => OTHER_APP_CHUNK.test(p))).toEqual([]);
  // ...but every script it loaded, and the other apps, are in the precache.
  for (const p of cacheState.loaded) expect(cacheState.precached).toContain(p);
  expect(cacheState.precached.filter((p) => OTHER_APP_CHUNK.test(p))).toHaveLength(3);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByPlaceholder("Search contacts...")).toBeVisible();
    // Calendar was never opened online.
    await page.goto("/calendar");
    await expect(page.getByRole("button", { name: "New event" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
