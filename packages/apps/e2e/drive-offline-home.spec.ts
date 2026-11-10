// The Drive home (All Files) offline (live app).
//
// Online, All Files comes from the server's search index. Offline there is no
// index to ask, so a reload of /drive must list the files of the offline copy
// instead of an empty list with an error toast. Back online, it lists the
// server's rows again.
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";
import {
  API,
  goOfflineKeepingShell,
  goOnlineAgain,
  installOnlineFlag,
} from "./helpers/drive-upload-live";

const RUN = Date.now().toString(36);
const FOLDER = `Offline home ${RUN}`;
const FILE = `offline-home-${RUN}.md`;
const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;

async function dav(method: string, path: string, body?: string): Promise<void> {
  const res = await fetch(`${API}/files/users/${E2E_USERNAME}/${path}`, {
    method,
    headers: { Authorization: basicAuth, "Content-Type": "text/markdown" },
    body,
  });
  if (!res.ok && !(method === "DELETE" && res.status === 404)) {
    throw new Error(`${method} ${path} failed: ${res.status}`);
  }
}

/** True once the offline copy holds the seeded file (read straight from IndexedDB). */
async function cachedSeededFile(page: Page): Promise<boolean> {
  return page.evaluate(async (name) => {
    const databases = (await indexedDB.databases())
      .map((entry) => entry.name ?? "")
      .filter((dbName) => dbName.startsWith("wgw-offline-"));
    for (const dbName of databases) {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      let found = false;
      if (db.objectStoreNames.contains("drive_entries")) {
        const ids = await new Promise<IDBValidKey[]>((resolve) => {
          const get = db
            .transaction("drive_entries", "readonly")
            .objectStore("drive_entries")
            .getAllKeys();
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => resolve([]);
        });
        found = ids.some((id) => String(id).endsWith(`/${name}`));
      }
      db.close();
      if (found) return true;
    }
    return false;
  }, FILE);
}

function fileRow(page: Page) {
  return page.getByText(FILE, { exact: true }).first();
}

/** A toast that reads as a failed load (the bug: `Failed to fetch` from /search). */
function errorToast(page: Page) {
  return page.locator("[data-sonner-toast]").filter({ hasText: /fail|fetch|search|error/i });
}

test.describe("Drive home offline (live app)", () => {
  test.beforeAll(async () => {
    await dav("MKCOL", `${encodeURIComponent(FOLDER)}/`);
    await dav("PUT", `${encodeURIComponent(FOLDER)}/${FILE}`, `# ${FILE}\n`);
  });

  test.afterAll(async () => {
    await dav("DELETE", `${encodeURIComponent(FOLDER)}/`);
  });

  test.beforeEach(async ({ context }) => {
    await installOnlineFlag(context);
  });

  test("an offline reload of /drive lists the offline copy; online lists the server", async ({
    page,
  }) => {
    test.setTimeout(150_000);

    // 1. Online: All Files lists the new file (the index may need a moment).
    await expect(async () => {
      await page.goto("/drive");
      await expect(fileRow(page)).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.locator('[data-connectivity="online"]')).toBeVisible();

    // 2. The first sync copies the drive's listing for offline use.
    await expect
      .poll(() => cachedSeededFile(page), { timeout: 90_000, intervals: [1_000] })
      .toBe(true);

    // 3. Offline reload: the cached files are listed, with no error.
    await goOfflineKeepingShell(page);
    await page.reload();
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 30_000 });
    await expect(fileRow(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("No files yet")).toHaveCount(0);
    await expect(errorToast(page)).toHaveCount(0);

    // 4. Back online: a reload lists the server's rows again.
    await goOnlineAgain(page);
    const serverListing = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/search/results"),
    );
    await page.reload();
    expect((await serverListing).status()).toBe(200);
    await expect(fileRow(page)).toBeVisible({ timeout: 30_000 });
    await expect(errorToast(page)).toHaveCount(0);
  });
});
