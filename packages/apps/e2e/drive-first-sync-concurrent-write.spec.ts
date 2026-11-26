// A file written while Drive's first sync runs (live app, #2063 C1).
//
// The first sync on a new device lists every folder, then stores the
// FileNode/changes token. That token must be the state from before the first
// listing: a file another client writes in between then arrives on the next
// sync. A token taken after the listings would skip it for good, and the file
// would be missing offline.
//
// The test answers the listing of one seeded folder, writes a file into that
// folder over WebDAV, and only then hands the listing to the app: the write
// lands deterministically inside the sync, after the folder was listed.
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_USERNAME } from "./helpers/notes-live";
import { putDriveFile, seedDriveFolder } from "./helpers/drive-seed";

const RUN = Date.now().toString(36);
const FOLDER = `During sync ${RUN}`;
const FOLDER_API_PATH = `/users/${E2E_USERNAME}/${FOLDER}`;
const FOLDER_URL = `/drive?view=folder&path=${encodeURIComponent(`My Drive/${FOLDER}`)}`;
const SEEDED = Array.from({ length: 4 }, (_, i) => `Seeded ${RUN} ${i + 1}.md`);
const ADDED = `Added during sync ${RUN}.md`;
const TOKEN_KEY = "drive:file-node-sync-state";

/** True when this device's offline store has a `meta` row `key`, or a drive row ending in `suffix`. */
async function offlineStoreHas(page: Page, store: "meta" | "drive_entries", match: string) {
  return page.evaluate(
    async ({ store, match }) => {
      const names = (await indexedDB.databases())
        .map((entry) => entry.name ?? "")
        .filter((name) => name.startsWith("wgw-offline-"));
      for (const name of names) {
        const db = await new Promise<IDBDatabase | null>((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });
        if (!db) continue;
        try {
          if (!db.objectStoreNames.contains(store)) continue;
          const keys = await new Promise<IDBValidKey[]>((resolve) => {
            const all = db.transaction(store, "readonly").objectStore(store).getAllKeys();
            all.onsuccess = () => resolve(all.result);
            all.onerror = () => resolve([]);
          });
          const found = keys.some((key) =>
            store === "meta" ? key === match : String(key).endsWith(match),
          );
          if (found) return true;
        } finally {
          db.close();
        }
      }
      return false;
    },
    { store, match },
  );
}

test.describe("Drive first sync and a concurrent write", () => {
  test("a file written while the first sync runs is listed offline afterwards", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await seedDriveFolder(FOLDER_API_PATH, SEEDED);

    // Hold the first answer that lists the seeded folder's files; write the
    // new file before the app sees that answer.
    let wrote = false;
    await page.route("**/api/v1/jmap", async (route) => {
      if (wrote) return route.continue();
      const response = await route.fetch();
      const body = await response.text();
      if (!wrote && body.includes(SEEDED[0]!)) {
        wrote = true;
        await putDriveFile(`${FOLDER_API_PATH}/${ADDED}`, `# Added ${RUN}\n`, "text/markdown");
      }
      return route.fulfill({ response, body });
    });

    await page.goto("/drive?view=folder&path=My%20Drive");
    await expect(page.getByText(FOLDER, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => wrote, { timeout: 120_000 }).toBe(true);
    // The first sync is complete once it stored its token.
    await expect
      .poll(() => offlineStoreHas(page, "meta", TOKEN_KEY), { timeout: 120_000 })
      .toBe(true);
    await page.unroute("**/api/v1/jmap");

    // Next app start: FileNode/changes from the stored token brings the file in.
    await page.reload();
    await expect
      .poll(() => offlineStoreHas(page, "drive_entries", `/${FOLDER}/${ADDED}`), {
        timeout: 60_000,
      })
      .toBe(true);

    // Offline: the folder listing comes from the cache.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    });
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "HEAD" && url.pathname === "/") return route.abort("failed");
      if (url.pathname.includes("/api/v1/")) return route.abort("failed");
      return route.continue();
    });
    await page.goto(FOLDER_URL);
    await expect(page.getByText(ADDED, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(SEEDED[0]!, { exact: true }).first()).toBeVisible();
  });
});
