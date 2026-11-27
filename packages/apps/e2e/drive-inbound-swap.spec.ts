// Names swapped by another client (live app, #2063 C1).
//
// Another client swaps two file names and two folder names (A → tmp, B → A,
// tmp → B). The next changes-only sync must move each node's offline copy
// with the node: a rename does not change a file's mtime, so a body left on
// the wrong path would be served offline for good. File bodies are not
// fetched again after the swap here, so only the move can put them right.
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_USERNAME } from "./helpers/notes-live";
import { moveDriveFile, putDriveFile, seedDriveFolder } from "./helpers/drive-seed";

const RUN = Date.now().toString(36);
const ROOT = `Swap ${RUN}`;
const ROOT_API = `/users/${E2E_USERNAME}/${ROOT}`;
const folderUrl = (path: string) =>
  `/drive?view=folder&path=${encodeURIComponent(`My Drive/${ROOT}${path}`)}`;
const BODIES: Record<string, string> = {
  "A.bin": "alpha",
  "B.bin": "beta beta",
  "FA/fa.bin": "inside FA",
  "FB/fb.bin": "inside FB, longer",
};
const TOKEN_KEY = "drive:file-node-sync-state";

/** Offline file bodies under the test folder, by path relative to it. */
async function offlineBodies(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async (root) => {
    const bodies: Record<string, string> = {};
    for (const info of await indexedDB.databases()) {
      if (!info.name?.startsWith("wgw-offline-")) continue;
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      if (db.objectStoreNames.contains("drive_content_blobs")) {
        const rows = await new Promise<Array<{ id: string; blob: Blob }>>((resolve) => {
          const get = db
            .transaction("drive_content_blobs", "readonly")
            .objectStore("drive_content_blobs")
            .getAll();
          get.onsuccess = () => resolve(get.result as never);
          get.onerror = () => resolve([]);
        });
        for (const row of rows) {
          const at = row.id.indexOf(`/${root}/`);
          if (at >= 0) bodies[row.id.slice(at + root.length + 2)] = await row.blob.text();
        }
      }
      db.close();
    }
    return bodies;
  }, ROOT);
}

async function hasToken(page: Page): Promise<boolean> {
  return page.evaluate(async (key) => {
    for (const info of await indexedDB.databases()) {
      if (!info.name?.startsWith("wgw-offline-")) continue;
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      const found = await new Promise<boolean>((resolve) => {
        if (!db.objectStoreNames.contains("meta")) return resolve(false);
        const get = db.transaction("meta", "readonly").objectStore("meta").getKey(key);
        get.onsuccess = () => resolve(get.result !== undefined);
        get.onerror = () => resolve(false);
      });
      db.close();
      if (found) return true;
    }
    return false;
  }, TOKEN_KEY);
}

/** Swap two names over WebDAV through a temporary name, as a desktop client would. */
async function swap(a: string, b: string): Promise<void> {
  const tmp = `${ROOT_API}/swap-tmp-${RUN}`;
  await moveDriveFile(`${ROOT_API}/${a}`, tmp);
  await moveDriveFile(`${ROOT_API}/${b}`, `${ROOT_API}/${a}`);
  await moveDriveFile(tmp, `${ROOT_API}/${b}`);
}

test.describe("Drive inbound sync and swapped names", () => {
  test("each file and folder keeps its own offline body after a swap", async ({ page }) => {
    test.setTimeout(300_000);
    for (const folder of ["", "/FA", "/FB"]) await seedDriveFolder(`${ROOT_API}${folder}`, []);
    for (const [path, body] of Object.entries(BODIES)) {
      await putDriveFile(`${ROOT_API}/${path}`, body, "application/octet-stream");
    }

    // First sync, then the content copy of all four bodies.
    await page.goto("/drive?view=folder&path=My%20Drive");
    await expect(page.getByText(ROOT, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => hasToken(page), { timeout: 120_000 }).toBe(true);
    await expect.poll(() => offlineBodies(page), { timeout: 180_000 }).toEqual(BODIES);
    await page.goto("about:blank");

    await swap("A.bin", "B.bin");
    await swap("FA", "FB");

    // Changes-only sync, with file bodies not fetched again.
    await page.route("**/api/v1/files/content**", (route) => route.abort("failed"));
    await page.goto("/drive?view=folder&path=My%20Drive");
    await expect
      .poll(() => offlineBodies(page), { timeout: 60_000 })
      .toEqual({
        "A.bin": "beta beta",
        "B.bin": "alpha",
        "FA/fb.bin": "inside FB, longer",
        "FB/fa.bin": "inside FA",
      });

    // Offline: the listings come from the cache.
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
    await page.goto(folderUrl("/FA"));
    await expect(page.getByText("fb.bin", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("fa.bin", { exact: true })).toHaveCount(0);
    await page.goto(folderUrl("/FB"));
    await expect(page.getByText("fa.bin", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("fb.bin", { exact: true })).toHaveCount(0);
  });
});
