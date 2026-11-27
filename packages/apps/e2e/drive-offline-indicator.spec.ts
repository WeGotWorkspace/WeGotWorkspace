// Drive's per-row offline indicator, stored thumbnails and team names offline
// (#2063 C5, live app).
//
// - A row spins only while the current copy will still download that file,
//   and never while the device is offline.
// - A download the server refuses shows as failed, also after a reload, and
//   its button retries the copy.
// - A thumbnail that was loaded once, or that has a stored copy, is not
//   downloaded again; offline it comes from the stored copy.
// - Team drives keep their display name offline, in Drive and in Docs home.
import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";
import {
  API,
  goOfflineKeepingShell,
  goOnlineAgain,
  installOnlineFlag,
  openFolder,
} from "./helpers/drive-upload-live";
import { ensureTeamNotebook, TEAM_NOTEBOOK_NAME, TEAM_SLUG } from "./helpers/notes-matrix";

const RUN = Date.now().toString(36);
const DOWNLOADING = "Downloading for offline use";
const FAILED = "Couldn't save for offline use. Try again";
const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;

/** 1×1 PNG. */
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** WebDAV, as a desktop client would. Retries a 429 so seeding never flakes on the budget. */
async function dav(
  method: string,
  path: string,
  body?: Uint8Array<ArrayBuffer> | string,
  type?: string,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const headers: Record<string, string> = { Authorization: basicAuth };
    if (type) headers["Content-Type"] = type;
    const res = await fetch(`${API}/files/users/${E2E_USERNAME}/${path}`, {
      method,
      headers,
      body,
    });
    if (res.status !== 429) {
      const exists = method === "MKCOL" && res.status === 405;
      const gone = method === "DELETE" && res.status === 404;
      if (!res.ok && !exists && !gone) throw new Error(`${method} ${path} failed: ${res.status}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`${method} ${path} stayed rate limited`);
}

/** Binary files take the plain content GET (`.md` files go through the Docs copy). */
async function seedBinaryFolder(folder: string, names: readonly string[]): Promise<void> {
  await dav("MKCOL", `${encodeURIComponent(folder)}/`);
  for (const name of names) {
    await dav(
      "PUT",
      `${encodeURIComponent(folder)}/${encodeURIComponent(name)}`,
      new Uint8Array(2048).fill(7),
      "application/octet-stream",
    );
  }
}

function folderUrl(folder: string): string {
  return `/drive?view=folder&path=${encodeURIComponent(`My Drive/${folder}`)}`;
}

/** Automatic offline copies on, small files only, before the app boots. */
async function enableContentCopies(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (!localStorage.getItem("wgw.offline.deviceContentSettings")) {
      localStorage.setItem(
        "wgw.offline.deviceContentSettings",
        JSON.stringify({ contentSyncEnabled: true, maxFileSizeBytes: 1024 * 1024 }),
      );
    }
  });
}

function contentPath(url: string): string {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.searchParams.get("path") ?? "");
}

function isContentGet(url: string): boolean {
  return new URL(url).pathname.endsWith("/files/content");
}

/** The row of one file: the smallest element holding its name and no other seeded name. */
function row(page: Page, name: string, others: readonly string[]) {
  const escaped = others
    .filter((other) => other !== name)
    .map((other) => other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const locator = page.locator("div,li,tr").filter({ has: page.getByText(name, { exact: true }) });
  return (
    escaped.length > 0 ? locator.filter({ hasNotText: new RegExp(escaped.join("|")) }) : locator
  ).first();
}

/** True once the device holds a stored copy of the file (read straight from IndexedDB). */
async function hasStoredCopy(page: Page, suffix: string): Promise<boolean> {
  return page.evaluate(async (wanted) => {
    for (const info of await indexedDB.databases()) {
      if (!info.name?.startsWith("wgw-offline-")) continue;
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      let found = false;
      if (db.objectStoreNames.contains("drive_content_blobs")) {
        const ids = await new Promise<IDBValidKey[]>((resolve) => {
          const get = db
            .transaction("drive_content_blobs", "readonly")
            .objectStore("drive_content_blobs")
            .getAllKeys();
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => resolve([]);
        });
        found = ids.some((id) => String(id).endsWith(wanted));
      }
      db.close();
      if (found) return true;
    }
    return false;
  }, suffix);
}

test.describe("Drive offline indicator, thumbnails and team names (live app)", () => {
  test.beforeEach(async ({ context }) => {
    await installOnlineFlag(context);
  });

  test("team drives keep their display name offline in Drive and Docs home", async ({ page }) => {
    test.setTimeout(150_000);
    await ensureTeamNotebook();
    const sidebarTeam = (p: Page) =>
      p.locator("aside").getByText(TEAM_NOTEBOOK_NAME, { exact: true });
    const sidebarSlug = (p: Page) => p.locator("aside").getByText(TEAM_SLUG, { exact: true });

    // Online: the names come from the server and are cached on the device.
    await page.goto("/drive");
    await expect(sidebarTeam(page).first()).toBeVisible({ timeout: 30_000 });
    await page.goto("/docs");
    await expect(sidebarTeam(page).first()).toBeVisible({ timeout: 30_000 });

    // Offline, after a reload: Drive still shows the display name, not the slug.
    await page.goto("/drive");
    await expect(sidebarTeam(page).first()).toBeVisible({ timeout: 30_000 });
    await goOfflineKeepingShell(page);
    await page.reload();
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 30_000 });
    await expect(sidebarTeam(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(sidebarSlug(page)).toHaveCount(0);

    // Docs home offline lists the team drive by its display name too.
    await page.goto("/docs");
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 30_000 });
    await expect(sidebarTeam(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(sidebarSlug(page)).toHaveCount(0);

    await goOnlineAgain(page);
  });

  test("no row spins once the device is offline", async ({ browser }) => {
    test.setTimeout(180_000);
    const folder = `Offline spin ${RUN}`;
    const names = Array.from({ length: 6 }, (_, i) => `spin-${RUN}-${i + 1}.bin`);
    await seedBinaryFolder(folder, names);

    const context = await browser.newContext();
    await installOnlineFlag(context);
    await enableContentCopies(context);
    const page = await context.newPage();
    // Hold every content GET so the copy is still running when the device goes offline.
    await page.route("**/files/content**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      await route.continue().catch(() => undefined);
    });
    const spinner = page.getByRole("button", { name: DOWNLOADING });

    try {
      await page.goto(folderUrl(folder));
      await expect(page.getByText(names[0]!, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(spinner.first()).toBeVisible({ timeout: 60_000 });

      await goOfflineKeepingShell(page);
      await expect(spinner).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await context.close();
      await dav("DELETE", `${encodeURIComponent(folder)}/`);
    }
  });

  test("a refused download shows as failed, survives a reload, and its button retries", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const folder = `Offline fail ${RUN}`;
    const broken = `broken-${RUN}.bin`;
    const fine = `fine-${RUN}.bin`;
    const names = [broken, fine];
    await seedBinaryFolder(folder, names);

    const context = await browser.newContext();
    await installOnlineFlag(context);
    await enableContentCopies(context);
    const page = await context.newPage();
    const refuse = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
      if (contentPath(route.request().url()).endsWith(`/${broken}`)) {
        await route.fulfill({ status: 500, body: "boom" });
        return;
      }
      await route.fallback();
    };
    await page.route("**/files/content**", refuse);
    const brokenRow = () => row(page, broken, names);

    try {
      await page.goto(folderUrl(folder));
      await expect(page.getByText(broken, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });

      // The copy runs; the refused file ends up failed, not spinning.
      await expect(brokenRow().getByRole("button", { name: FAILED })).toBeVisible({
        timeout: 90_000,
      });
      await expect(brokenRow().getByRole("button", { name: DOWNLOADING })).toHaveCount(0);
      await expect.poll(() => hasStoredCopy(page, `/${fine}`), { timeout: 90_000 }).toBe(true);

      // A reload keeps the failed mark (it lives in the device's meta store).
      await page.reload();
      await expect(brokenRow().getByRole("button", { name: FAILED })).toBeVisible({
        timeout: 30_000,
      });
      await expect(brokenRow().getByRole("button", { name: DOWNLOADING })).toHaveCount(0);

      // The server serves it again: the button stores a copy and the row settles.
      await page.unroute("**/files/content**", refuse);
      await brokenRow().getByRole("button", { name: FAILED }).click();
      await expect.poll(() => hasStoredCopy(page, `/${broken}`), { timeout: 60_000 }).toBe(true);
      await expect(brokenRow().getByRole("button", { name: FAILED })).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(brokenRow().getByRole("button", { name: DOWNLOADING })).toHaveCount(0);
    } finally {
      await context.close();
      await dav("DELETE", `${encodeURIComponent(folder)}/`);
    }
  });

  test("a thumbnail is not downloaded again, and shows offline from the stored copy", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const folder = `Offline thumb ${RUN}`;
    const inner = `Inner-${RUN}`;
    const image = `thumb-${RUN}.png`;
    await dav("MKCOL", `${encodeURIComponent(folder)}/`);
    await dav("MKCOL", `${encodeURIComponent(folder)}/${encodeURIComponent(inner)}/`);
    await dav(
      "PUT",
      `${encodeURIComponent(folder)}/${encodeURIComponent(image)}`,
      PNG,
      "image/png",
    );

    const context = await browser.newContext();
    await installOnlineFlag(context);
    await enableContentCopies(context);
    const page = await context.newPage();
    const imageGets: string[] = [];
    page.on("request", (request) => {
      if (isContentGet(request.url()) && contentPath(request.url()).endsWith(`/${image}`)) {
        imageGets.push(request.url());
      }
    });
    const thumbnail = () => page.locator(`img[src^="blob:"]`).first();

    try {
      await page.goto(folderUrl(folder));
      await expect(page.getByText(image, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      // Grid view (the default), so image tiles show thumbnails.
      await page.getByRole("button", { name: "Grid view", exact: true }).click();
      await expect(thumbnail()).toBeVisible({ timeout: 60_000 });
      // Wait for the automatic copy to store the image, so later loads have a stored copy.
      await expect.poll(() => hasStoredCopy(page, `/${image}`), { timeout: 90_000 }).toBe(true);

      // Into another folder and back: the thumbnail does not download again.
      const before = imageGets.length;
      await openFolder(page, inner);
      await page.goBack();
      await expect(page.getByText(image, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(thumbnail()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2_000);
      expect(imageGets.length).toBe(before);

      // Offline, after a reload: the thumbnail comes from the stored copy.
      await goOfflineKeepingShell(page);
      await page.reload();
      await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(image, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(thumbnail()).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
      await dav("DELETE", `${encodeURIComponent(folder)}/`);
    }
  });
});
