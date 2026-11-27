// Drive views on the device's file tree (#2063 C3), live app.
//
// After the first sync, every Drive view (All Files, a folder, Starred, Shared
// with me, Trash) reads the local file tree: a reload shows its rows without a
// spinner and without a server listing. Writes in one tab show in the other
// without a reload. Offline, every view lists what the device holds; a folder
// it never synced says so instead of looking empty.
import { type BrowserContext, expect, type Page, test } from "./helpers/live-test";
import { api, dav, makeFolder, putDoc, TEAMMATE, unshareQuietly } from "./helpers/docs-matrix";
import { E2E_USERNAME } from "./helpers/notes-live";
import {
  API,
  jmapFileNodes,
  goOfflineKeepingShell,
  goOnlineAgain,
  installOnlineFlag,
} from "./helpers/drive-upload-live";

const RUN = Date.now().toString(36);
const HOME = `/users/${E2E_USERNAME}`;
const FOLDER = `Tree views ${RUN}`;
const GONE = `Tree gone ${RUN}`;
const FILE = `tree-file-${RUN}.md`;
const RENAMED = `tree-renamed-${RUN}.md`;
const STARRED = `tree-starred-${RUN}.md`;
const TRASHED = `tree-trashed-${RUN}.md`;
const SHARED = `tree-shared-${RUN}.md`;
const SHARED_PATH = `/users/${TEAMMATE}/${SHARED}`;

const LOADING = "Loading…";
const NOT_AVAILABLE = "Not available offline yet";
const FOLDER_MISSING = "This folder isn't here any more";

function folderUrl(uiPath: string): string {
  return `/drive?view=folder&path=${encodeURIComponent(uiPath)}`;
}

function row(page: Page, name: string) {
  return page.getByText(name, { exact: true }).first();
}

/** *More actions* on a row, then one of its menu items. */
async function rowAction(page: Page, name: string, item: string): Promise<void> {
  const tile = row(page, name).locator(
    "xpath=ancestor::*[.//button[@aria-label='More actions']][1]",
  );
  await tile.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/** A toast that reads as a failed load. */
function errorToast(page: Page) {
  return page.locator("[data-sonner-toast]").filter({ hasText: /fail|fetch|error/i });
}

/** True once the first sync on this device finished (read straight from IndexedDB). */
async function firstSyncDone(page: Page): Promise<boolean> {
  return page.evaluate(async (user) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(`wgw-offline-${user}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains("meta")) return false;
    const key = await new Promise<IDBValidKey | undefined>((resolve) => {
      const get = db.transaction("meta").objectStore("meta").getKey("drive:tree-sync:first-done");
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => resolve(undefined);
    });
    db.close();
    return key !== undefined;
  }, E2E_USERNAME);
}

/** Records, from document start, whether the full-pane loading state ever showed. */
async function watchForLoading(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const seen = () => {
      if (document.querySelector(".collection-state--loading")) {
        (window as unknown as { __sawLoading?: boolean }).__sawLoading = true;
      }
    };
    new MutationObserver(seen).observe(document, { subtree: true, childList: true });
  });
}

async function sawLoading(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __sawLoading?: boolean }).__sawLoading === true,
  );
}

/**
 * Server listings the tree views must no longer send: the All Files search and
 * a listing of the open folder. (The app bootstrap still lists the home root in
 * the background; that is not a view listing.)
 */
function watchListingRequests(page: Page, folderId: string): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/search/results")) seen.push(url.pathname);
    if (url.pathname.endsWith("/jmap")) {
      const body = request.postData() ?? "";
      if (body.includes("FileNode/query") && body.includes(`{"parentId":"${folderId}"}`)) {
        seen.push(`FileNode/query ${FOLDER}`);
      }
    }
  });
  return seen;
}

test.describe("Drive views on the file tree (live app)", () => {
  test.beforeAll(async () => {
    await makeFolder(E2E_USERNAME, `${HOME}/${FOLDER}`);
    await putDoc(E2E_USERNAME, `${HOME}/${FOLDER}/${FILE}`, `# ${FILE}\n`);
    await putDoc(E2E_USERNAME, `${HOME}/${FOLDER}/${STARRED}`, `# ${STARRED}\n`);
    await makeFolder(E2E_USERNAME, `${HOME}/${GONE}`);
    await putDoc(E2E_USERNAME, `${HOME}/${GONE}/inside.md`, "# inside\n");
    // 3. A file in Trash.
    await makeFolder(E2E_USERNAME, `${HOME}/.Trash`);
    await putDoc(E2E_USERNAME, `${HOME}/${TRASHED}`, `# ${TRASHED}\n`);
    const moved = await dav(E2E_USERNAME, "MOVE", `${HOME}/${TRASHED}`, {
      headers: { Destination: `${API}/files${HOME}/.Trash/${encodeURIComponent(TRASHED)}` },
    });
    if (!moved.ok) throw new Error(`MOVE ${TRASHED} to Trash: ${moved.status}`);
    // 2. A file the teammate shares with the E2E user.
    await putDoc(TEAMMATE, SHARED_PATH, `# ${SHARED}\n`);
    const shared = await api(TEAMMATE, "POST", "/files/shares", {
      path: SHARED_PATH,
      kind: "member",
      defaultAccess: "view",
      shareWith: { [E2E_USERNAME]: { access: "view" } },
    });
    if (shared.status >= 300) throw new Error(`share ${SHARED}: ${JSON.stringify(shared.json)}`);
  });

  test.afterAll(async () => {
    await unshareQuietly(TEAMMATE, SHARED_PATH);
    for (const path of [
      `${HOME}/${FOLDER}/`,
      `${HOME}/${GONE}/`,
      `${HOME}/.Trash/${encodeURIComponent(GONE)}/`,
      `${HOME}/.Trash/${encodeURIComponent(TRASHED)}`,
      SHARED_PATH,
    ]) {
      const user = path === SHARED_PATH ? TEAMMATE : E2E_USERNAME;
      await dav(user, "DELETE", path).catch(() => undefined);
    }
  });

  test.beforeEach(async ({ context }) => {
    await installOnlineFlag(context);
    await watchForLoading(context);
  });

  test("every view reads the tree: no spinner, live across tabs, offline too", async ({
    page,
    context,
  }) => {
    test.setTimeout(360_000);

    // 1 + 4. Open Drive on this new device and wait for the first sync.
    await page.goto(folderUrl(`My Drive/${FOLDER}`));
    await expect(row(page, FILE)).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => firstSyncDone(page), { timeout: 90_000, intervals: [1_000] })
      .toBe(true);
    // 1. Star a file through the UI.
    await rowAction(page, STARRED, "Star");

    // 5. Reload online: the rows show at once, with no spinner and no server listing.
    const found = await jmapFileNodes(page, "FileNode/query", { filter: { name: FOLDER } });
    const folderId = (found.ids as string[])[0]!;
    expect(folderId, `${FOLDER} on the server`).toBeTruthy();
    const listings = watchListingRequests(page, folderId);
    await page.reload();
    await expect(row(page, FILE)).toBeVisible({ timeout: 15_000 });
    // All Files holds the whole drive (windowed); Recent and Starred are short.
    for (const view of ["all", "recent", "starred"]) {
      await page.goto(`/drive?view=${view}`);
      if (view !== "all") await expect(row(page, STARRED)).toBeVisible({ timeout: 15_000 });
    }
    expect(await sawLoading(page)).toBe(false);
    expect(listings).toEqual([]);

    // 6. A rename in tab B shows in tab A without a reload.
    await page.goto(folderUrl(`My Drive/${FOLDER}`));
    await expect(row(page, FILE)).toBeVisible();
    const tabB = await context.newPage();
    await tabB.goto(folderUrl(`My Drive/${FOLDER}`));
    await rowAction(tabB, FILE, "Rename");
    const renameField = tabB.getByRole("dialog").getByRole("textbox");
    await renameField.fill(RENAMED.replace(/\.md$/, ""));
    await tabB.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
    await expect(row(page, RENAMED)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(FILE, { exact: true })).toHaveCount(0);

    // 7. Tab B deletes the folder tab A has open: tab A says so, with no spinner.
    await page.goto(folderUrl(`My Drive/${GONE}`));
    await expect(row(page, "inside.md")).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __sawLoading?: boolean }).__sawLoading = false;
    });
    await tabB.goto(folderUrl("My Drive"));
    await rowAction(tabB, GONE, "Delete");
    await tabB.getByRole("button", { name: "Move to Trash" }).click();
    await expect(page.getByText(FOLDER_MISSING)).toBeVisible({ timeout: 20_000 });
    expect(await sawLoading(page)).toBe(false);
    await tabB.close();

    // 8. Offline reload: every view lists what the device holds; search filters by name.
    await page.goto("/drive?view=all");
    await goOfflineKeepingShell(page);
    await page.reload();
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 30_000 });
    const search = page.getByRole("searchbox", { name: /search/i });
    await search.fill(STARRED.slice(0, -3));
    await expect(row(page, STARRED)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(RENAMED, { exact: true })).toHaveCount(0);
    await search.fill(RENAMED.slice(0, -3));
    await expect(row(page, RENAMED)).toBeVisible();
    await search.fill("");
    for (const [url, name] of [
      ["/drive?view=recent", RENAMED],
      ["/drive?view=starred", STARRED],
      ["/drive?view=shared", SHARED],
      [folderUrl("Trash"), TRASHED],
    ] as const) {
      await page.goto(url);
      await expect(row(page, name)).toBeVisible({ timeout: 30_000 });
    }

    // 9. Still offline: a folder this device never synced is not available, never empty.
    await page.goto(folderUrl("My Drive/Never synced"));
    await expect(page.getByText(NOT_AVAILABLE)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("This folder is empty")).toHaveCount(0);
    await expect(page.getByText(LOADING)).toHaveCount(0);

    // 10. Back online: every view lists its rows again, with no error.
    await goOnlineAgain(page);
    for (const [url, name] of [
      ["/drive?view=recent", RENAMED],
      ["/drive?view=starred", STARRED],
      ["/drive?view=shared", SHARED],
      [folderUrl("Trash"), TRASHED],
    ] as const) {
      await page.goto(url);
      await expect(row(page, name)).toBeVisible({ timeout: 30_000 });
    }
    await expect(errorToast(page)).toHaveCount(0);
  });
});
