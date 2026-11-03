import { expect, test } from "./helpers/live-test";
import {
  FULL,
  WAITING_SPACE,
  GONE,
  uploadInput,
  openMyDrive,
  pickFile,
  queueIntoFolder,
  goOnlineAgain,
  uniqueName,
  namesIn,
  renameFolderOnServer,
  trashFolderOnServer,
  openFolder,
  openUploads,
  uploadRow,
} from "./helpers/drive-upload-live";

test.describe("Drive upload errors (live app)", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "onLine", {
        configurable: true,
        get: () => sessionStorage.getItem("e2e-offline") !== "1",
      });
    });
  });

  test("a folder renamed in another tab still receives the queued file", async ({ page }) => {
    const from = uniqueName("a");
    const to = uniqueName("b");
    const file = `${uniqueName("renamed")}.txt`;
    const other = await queueIntoFolder(page, from, file);

    await renameFolderOnServer(other, from, to);
    await goOnlineAgain(page);

    await expect.poll(() => namesIn(other, to), { timeout: 60_000 }).toContain(file);
    expect(await namesIn(other, from)).not.toContain(file);
    // Nothing failed: the queue is empty in both tabs.
    await expect(other.getByRole("button", { name: /^Uploads/ })).toHaveCount(0, {
      timeout: 60_000,
    });
    for (const tab of [page, other]) {
      await openMyDrive(tab);
      await openFolder(tab, to);
      await expect(tab.getByText(file, { exact: true })).toBeVisible({ timeout: 30_000 });
    }
  });

  test("a folder trashed in another tab fails the queued file as gone, and it stays after a reload", async ({
    page,
  }) => {
    const folder = uniqueName("trashed");
    const file = `${uniqueName("trashed-file")}.txt`;
    const other = await queueIntoFolder(page, folder, file);

    await trashFolderOnServer(other, folder);
    await goOnlineAgain(page);

    await openUploads(page);
    await expect(uploadRow(page, file)).toContainText(GONE, { timeout: 60_000 });
    await openUploads(other);
    await expect(uploadRow(other, file)).toContainText(GONE, { timeout: 60_000 });

    expect(await namesIn(other, "")).not.toContain(file);
    expect(await namesIn(other, ".Trash")).not.toContain(file);
    expect(await namesIn(other, `.Trash/${folder}`)).not.toContain(file);

    await page.reload();
    await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
    await openUploads(page);
    await expect(uploadRow(page, file)).toContainText(GONE, { timeout: 30_000 });
  });

  test("a full server pauses the queue, and Retry uploads every file once", async ({ page }) => {
    const first = `${uniqueName("full-1")}.txt`;
    const second = `${uniqueName("full-2")}.txt`;
    await openMyDrive(page);
    const other = await page.context().newPage();
    await openMyDrive(other);

    let reachedServer = 0;
    // On the context: the second tab runs an uploader too.
    await page.context().route("**/jmap/upload**", (route) => {
      reachedServer += 1;
      return route.fulfill({
        status: 507,
        contentType: "application/problem+json",
        body: JSON.stringify({ type: "urn:ietf:params:jmap:error:overQuota", status: 507 }),
      });
    });
    await uploadInput(page).setInputFiles([
      { name: first, mimeType: "text/plain", buffer: Buffer.from("first") },
      { name: second, mimeType: "text/plain", buffer: Buffer.from("second") },
    ]);

    await openUploads(page);
    await expect(uploadRow(page, first)).toContainText(FULL, { timeout: 60_000 });
    await expect(uploadRow(page, second)).toContainText(WAITING_SPACE, { timeout: 60_000 });
    await openUploads(other);
    await expect(uploadRow(other, first)).toContainText(FULL, { timeout: 60_000 });
    await expect(uploadRow(other, second)).toContainText(WAITING_SPACE, { timeout: 60_000 });
    // Only the first file asked; the second never reached the server.
    expect(reachedServer).toBeGreaterThan(0);
    expect(await namesIn(page, "")).not.toContain(second);

    await page.context().unroute("**/jmap/upload**");
    await uploadRow(page, first)
      .getByRole("button", { name: `Retry ${first}` })
      .click();

    await expect(page.locator(".drive-upload-status")).toHaveCount(0, { timeout: 90_000 });
    await expect
      .poll(
        async () => {
          const names = await namesIn(page, "");
          return [first, second].map((name) => names.filter((n) => n === name).length);
        },
        { timeout: 60_000 },
      )
      .toEqual([1, 1]);
  });

  test("a waiting upload finishes in a tab that never saw the failed attempt", async ({ page }) => {
    const file = `${uniqueName("wake")}.txt`;
    await openMyDrive(page);

    let hits = 0;
    await page.context().route("**/jmap/upload**", (route) => {
      hits += 1;
      return route.abort("failed");
    });
    await pickFile(page, file);
    await expect.poll(() => hits, { timeout: 60_000 }).toBeGreaterThan(0);
    await openUploads(page);
    await expect(uploadRow(page, file)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".drive-uploads__row--failed")).toHaveCount(0);

    // Tab B starts after the item already has a future retry time.
    const other = await page.context().newPage();
    await openMyDrive(other);
    await page.close();
    await other.context().unroute("**/jmap/upload**");

    await expect
      .poll(async () => (await namesIn(other, "")).filter((n) => n === file).length, {
        timeout: 90_000,
      })
      .toBe(1);
    await expect(other.getByRole("button", { name: /^Uploads/ })).toHaveCount(0, {
      timeout: 60_000,
    });
  });

  test("a create whose answer is lost does not make a (1) copy", async ({ page }) => {
    const stem = uniqueName("lost");
    const file = `${stem}.txt`;
    await openMyDrive(page);

    let intercepted = 0;
    await page.route(/\/api\/v1\/jmap(\?.*)?$/, async (route) => {
      const request = route.request();
      const body = request.postData() ?? "";
      if (
        intercepted === 0 &&
        request.method() === "POST" &&
        body.includes('"FileNode/set"') &&
        body.includes('"create"')
      ) {
        intercepted += 1;
        await route.fetch();
        return route.abort("failed");
      }
      return route.fallback();
    });
    await pickFile(page, file);
    await expect.poll(() => intercepted, { timeout: 60_000 }).toBe(1);

    // Before the retry: the stored placing state has to survive the reload.
    await page.reload();
    await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
    await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole("button", { name: /^Uploads/ })).toHaveCount(0, {
      timeout: 90_000,
    });
    const names = await namesIn(page, "");
    expect(names.filter((n) => n === file)).toHaveLength(1);
    expect(names.filter((n) => n.startsWith(`${stem} (`))).toHaveLength(0);
  });
});
