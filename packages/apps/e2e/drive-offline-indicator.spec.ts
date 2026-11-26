// Drive offline indicators (live app, #2063 C5).
//
// Offline, a row never spins for a copy that cannot run, a failed copy shows as
// failed (also after a reload), team drives keep their display names in Drive
// and Docs, and a stored thumbnail is not fetched again.
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";
import { gotoDocsHome } from "./helpers/docs-live";
import { ensureTeamNotebook } from "./helpers/notes-matrix";
import {
  API,
  goOfflineKeepingShell,
  goOnlineAgain,
  installOnlineFlag,
  openFolder,
  openMyDrive,
} from "./helpers/drive-upload-live";

const RUN = Date.now().toString(36);
const TEAM_NAME = "E2E Notes Team";
const TEAM_SLUG = "e2e-notes-team";
const SETTINGS_KEY = "wgw.offline.deviceContentSettings";
const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;

/** 1×1 PNG. */
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function dav(
  method: string,
  path: string,
  body?: Uint8Array<ArrayBuffer> | string,
  type?: string,
): Promise<void> {
  const headers: Record<string, string> = { Authorization: basicAuth };
  if (type) headers["Content-Type"] = type;
  const res = await fetch(`${API}/files/users/${E2E_USERNAME}/${path}`, {
    method,
    headers,
    body,
  });
  const ok = res.ok || (method === "MKCOL" && res.status === 405);
  if (!ok && !(method === "DELETE" && res.status === 404)) {
    throw new Error(`${method} ${path} failed: ${res.status}`);
  }
}

const downloading = (page: Page) =>
  page.getByRole("button", { name: "Downloading for offline use" });
const failedCopy = (page: Page) =>
  page.getByRole("button", { name: "Couldn't save for offline use. Try again" });

function contentSettings(page: Page, enabled: boolean) {
  return page.context().addInitScript(
    ([key, on]) => {
      if (!localStorage.getItem(key as string)) {
        localStorage.setItem(
          key as string,
          JSON.stringify({ contentSyncEnabled: on, maxFileSizeBytes: 1024 * 1024 }),
        );
      }
    },
    [SETTINGS_KEY, enabled] as const,
  );
}

test.describe("Drive offline indicators (live app)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ context }) => {
    await installOnlineFlag(context);
  });

  test.beforeAll(async () => {
    await ensureTeamNotebook();
  });

  test("team drives keep their display names offline in Drive and Docs", async ({ page }) => {
    test.setTimeout(150_000);
    await openMyDrive(page);
    await expect(page.getByText(TEAM_NAME, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    // Docs home online too, so both apps have cached the team names.
    await gotoDocsHome(page);
    await expect(page.getByText(TEAM_NAME, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    await goOfflineKeepingShell(page);
    await page.goto("/drive");
    await expect(page.getByText(TEAM_NAME, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(TEAM_SLUG, { exact: true })).toHaveCount(0);

    await page.goto("/docs");
    await expect(page.getByText(TEAM_NAME, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(TEAM_SLUG, { exact: true })).toHaveCount(0);
  });

  test.describe("copies", () => {
    const FOLDER = `Indicator ${RUN}`;
    const folderPath = encodeURIComponent(FOLDER);
    const FILES = Array.from({ length: 6 }, (_, i) => `Ind ${RUN} ${i + 1}.md`);
    // A plain file: its body comes from the content GET (documents use a collaboration snapshot).
    const FAILING = `Ind ${RUN} failing.bin`;
    const folderUrl = `/drive?view=folder&path=${encodeURIComponent(`My Drive/${FOLDER}`)}`;

    test.beforeAll(async () => {
      await dav("MKCOL", `${folderPath}/`);
      await dav(
        "PUT",
        `${folderPath}/${encodeURIComponent(FAILING)}`,
        "x",
        "application/octet-stream",
      );
      for (const name of FILES) {
        await dav(
          "PUT",
          `${folderPath}/${encodeURIComponent(name)}`,
          `# ${name}\n`,
          "text/markdown",
        );
      }
    });

    test.afterAll(async () => {
      await dav("DELETE", `${folderPath}/`);
    });

    test("no spinner while offline", async ({ page }) => {
      test.setTimeout(150_000);
      await contentSettings(page, true);
      // Keep the copy running long enough to see it.
      await page.route(/\/api\/v1\/files\/(content|collaboration)\?/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        await route.continue().catch(() => undefined);
      });
      await page.goto(folderUrl);
      await expect(page.getByText(FILES[0]!, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(downloading(page).first()).toBeVisible({ timeout: 30_000 });

      await goOfflineKeepingShell(page);
      await expect(downloading(page)).toHaveCount(0, { timeout: 5_000 });
    });

    test("a failed copy shows as failed, after a reload too, and a retry stores it", async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await contentSettings(page, true);
      const refuse = (route: import("@playwright/test").Route) => {
        const path = new URL(route.request().url()).searchParams.get("path") ?? "";
        return path.endsWith(`/${FAILING}`)
          ? route.fulfill({ status: 500, body: "boom" })
          : route.fallback();
      };
      await page.route(/\/api\/v1\/files\/content\?/, refuse);

      await page.goto(folderUrl);
      await expect(page.getByText(FAILING, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(failedCopy(page)).toHaveCount(1, { timeout: 120_000 });
      await expect(downloading(page)).toHaveCount(0, { timeout: 120_000 });

      await page.reload();
      await expect(page.getByText(FAILING, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(failedCopy(page)).toHaveCount(1, { timeout: 30_000 });

      await page.unroute(/\/api\/v1\/files\/content\?/, refuse);
      await failedCopy(page).click();
      await expect(failedCopy(page)).toHaveCount(0, { timeout: 60_000 });
      await expect(downloading(page)).toHaveCount(0, { timeout: 60_000 });
      await expect(page.getByRole("button", { name: "Make available offline" })).toHaveCount(0);
    });
  });

  test("a stored thumbnail is not fetched again", async ({ page }) => {
    test.setTimeout(150_000);
    const FOLDER = `Thumbs-${RUN}`;
    const OTHER = `Thumbs-other-${RUN}`;
    const IMAGE = `thumb-${RUN}.png`;
    for (const folder of [FOLDER, OTHER]) await dav("MKCOL", `${encodeURIComponent(folder)}/`);
    await dav("PUT", `${encodeURIComponent(FOLDER)}/${IMAGE}`, PNG, "image/png");
    try {
      await contentSettings(page, false);
      await page
        .context()
        .addInitScript(() => localStorage.setItem("wgw.ui.drive.viewMode", "grid"));
      let imageRequests = 0;
      // However the app reads the bytes (content endpoint or DAV), it names the file.
      page.on("request", (request) => {
        if (request.method() === "GET" && decodeURIComponent(request.url()).includes(`/${IMAGE}`)) {
          imageRequests += 1;
        }
      });

      await openMyDrive(page);
      await openFolder(page, FOLDER);
      const thumbnail = page.locator('img[src^="blob:"]').first();
      await expect(thumbnail).toBeVisible({ timeout: 30_000 });
      const afterFirst = imageRequests;
      expect(afterFirst).toBeGreaterThan(0);

      await page.goBack();
      await openFolder(page, OTHER);
      await page.goBack();
      await openFolder(page, FOLDER);
      await expect(thumbnail).toBeVisible({ timeout: 30_000 });
      expect(imageRequests).toBe(afterFirst);
    } finally {
      await dav("DELETE", `${encodeURIComponent(FOLDER)}/`);
      await dav("DELETE", `${encodeURIComponent(OTHER)}/`);
    }
  });
});
