import { expect, test, type Page } from "./helpers/live-test";
import { E2E_USERNAME, expectOfflineIndicator } from "./helpers/notes-live";

const WAITING = "Waiting for a connection";

async function openMyDrive(page: Page): Promise<void> {
  await page.goto("/drive");
  await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 30_000 });
  // Wait until the folder listing has painted before going offline.
  await expect(page.getByText("Loading folder…")).toHaveCount(0, { timeout: 30_000 });
  // The folder listing is written to the offline cache just after it paints.
  await page.waitForTimeout(3_000);
}

function uploadInput(page: Page) {
  return page.locator('input[type="file"][aria-label="Upload files"]');
}

async function pickFile(page: Page, name: string): Promise<void> {
  await uploadInput(page).setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(`drive upload queue ${name}`),
  });
}

/**
 * Offline in a way that a page reload survives: the dev server stays reachable
 * for the document and its scripts, but every API, JMAP and probe request fails.
 */
async function goOfflineKeepingShell(page: Page): Promise<void> {
  await page.context().route("**/*", (route) => {
    const type = route.request().resourceType();
    return type === "fetch" || type === "xhr" || type === "eventsource"
      ? route.abort("internetdisconnected")
      : route.fallback();
  });
  await page.evaluate(() => {
    sessionStorage.setItem("e2e-offline", "1");
    window.dispatchEvent(new Event("offline"));
  });
  await expectOfflineIndicator(page);
}

/** Flip a further tab of the same context to offline, after `goOfflineKeepingShell`. */
async function markOffline(page: Page, offline: boolean): Promise<void> {
  await page.evaluate((value) => {
    if (value) sessionStorage.setItem("e2e-offline", "1");
    else sessionStorage.removeItem("e2e-offline");
    window.dispatchEvent(new Event(value ? "offline" : "online"));
  }, offline);
}

async function goOnlineAgain(page: Page): Promise<void> {
  await page.context().unrouteAll({ behavior: "ignoreErrors" });
  await page.evaluate(() => {
    sessionStorage.removeItem("e2e-offline");
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 30_000 });
}

function status(page: Page, text: string) {
  return page.locator(".drive-upload-status", { hasText: text });
}

function uniqueName(label: string): string {
  return `e2e-upload-${label}-${Date.now()}.txt`;
}

/** Files in My Drive on the server. Needs the page to be online. */
async function serverFiles(page: Page): Promise<{ name: string; size?: number }[]> {
  return page.evaluate(async (username) => {
    const token = localStorage.getItem("wgw.api.access_token");
    const response = await fetch(
      `/api/v1/files/children?path=${encodeURIComponent(`/users/${username}`)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) throw new Error(`Listing failed (${response.status})`);
    const payload = (await response.json()) as {
      data: { files: { name: string; size?: number }[] };
    };
    return payload.data.files;
  }, E2E_USERNAME);
}

async function serverNames(page: Page): Promise<string[]> {
  return (await serverFiles(page)).map((file) => file.name);
}

async function expectOnServerOnce(page: Page, name: string): Promise<void> {
  const copy = name.replace(/\.txt$/, " (1).txt");
  await expect
    .poll(
      async () => {
        const names = await serverNames(page);
        return [names.filter((n) => n === name).length, names.filter((n) => n === copy).length];
      },
      { timeout: 60_000 },
    )
    .toEqual([1, 0]);
}

test.describe("Drive upload queue (live app)", () => {
  test.beforeEach(async ({ context }) => {
    // `goOfflineKeepingShell` flips this flag; it survives a reload of the tab.
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "onLine", {
        configurable: true,
        get: () => sessionStorage.getItem("e2e-offline") !== "1",
      });
    });
  });

  test("offline upload survives a reload and uploads once when back online", async ({ page }) => {
    const name = uniqueName("offline");
    await openMyDrive(page);

    await goOfflineKeepingShell(page);
    await pickFile(page, name);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(status(page, WAITING)).toHaveCount(1);

    await page.reload();
    await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(status(page, WAITING)).toHaveCount(1);

    await goOnlineAgain(page);
    await expect(status(page, WAITING)).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expectOnServerOnce(page, name);
  });

  test("a reload during the upload resumes it without a duplicate", async ({ page }) => {
    const name = uniqueName("reload");
    await openMyDrive(page);

    // Hold the transfer so the reload lands while the item is still in flight.
    await page.route("**/jmap/upload**", () => new Promise<void>(() => {}));
    await pickFile(page, name);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.locator(".drive-upload-status")).toHaveCount(1);
    await page.unroute("**/jmap/upload**");

    await page.reload();
    await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
    await expect(page.locator(".drive-upload-status")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expectOnServerOnce(page, name);
  });

  test("a reload in the middle of a multi-part upload resumes from the next part", async ({
    page,
  }) => {
    const name = uniqueName("parts");
    const partSize = 256 * 1024;
    // Five parts: four full ones and a short tail.
    const buffer = Buffer.alloc(4 * partSize + 100);
    for (let i = 0; i < buffer.length; i += 1) buffer[i] = (i * 31 + (i >> 8)) & 0xff;
    await openMyDrive(page);
    await page.evaluate(
      ([username, size]) => localStorage.setItem(`wgw-drive-part-size:${username}`, size),
      [E2E_USERNAME, String(partSize)],
    );
    await page.reload();
    await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });

    let seen = 0;
    let acknowledged = 0;
    page.on("response", (response) => {
      if (response.url().includes("/jmap/upload") && response.request().method() === "POST") {
        acknowledged += 1;
      }
    });
    await page.route("**/jmap/upload**", (route) => {
      seen += 1;
      return seen <= 2 ? route.continue() : new Promise<void>(() => {});
    });
    await uploadInput(page).setInputFiles({ name, mimeType: "text/plain", buffer });
    await expect.poll(() => acknowledged, { timeout: 60_000 }).toBe(2);
    await expect.poll(() => seen, { timeout: 30_000 }).toBe(3);
    await page.unroute("**/jmap/upload**");

    let afterReload = 0;
    page.on("request", (request) => {
      if (request.url().includes("/jmap/upload") && request.method() === "POST") afterReload += 1;
    });
    await page.reload();
    await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
    await expect(page.locator(".drive-upload-status")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expectOnServerOnce(page, name);
    expect(afterReload).toBe(3);
    const stored = (await serverFiles(page)).find((file) => file.name === name);
    expect(stored?.size).toBe(buffer.length);
  });

  test("a second tab shows the placeholder and then the file without a reload", async ({
    page,
  }) => {
    const name = uniqueName("tabs");
    await openMyDrive(page);
    const other = await page.context().newPage();
    await openMyDrive(other);

    // Offline keeps the placeholder on screen long enough to assert it.
    await goOfflineKeepingShell(page);
    await markOffline(other, true);
    await pickFile(page, name);
    await expect(other.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(status(other, WAITING)).toHaveCount(1);

    await goOnlineAgain(page);
    await markOffline(other, false);
    await expect(status(other, WAITING)).toHaveCount(0, { timeout: 60_000 });
    await expect(other.getByText(name, { exact: true })).toBeVisible();
    await expect(status(page, WAITING)).toHaveCount(0, { timeout: 60_000 });
    await expectOnServerOnce(page, name);
  });

  test("a second tab lists the queued file in the Uploads view and links to the folder when done", async ({
    page,
  }) => {
    const name = uniqueName("uploads-view");
    await openMyDrive(page);
    const other = await page.context().newPage();
    await openMyDrive(other);

    // Both tabs report offline: the second tab's status comes from its own connectivity.
    await goOfflineKeepingShell(page);
    await markOffline(other, true);
    await pickFile(page, name);
    await expect(page.getByText("Added 1 file to uploads")).toBeVisible();
    await expect(page.getByText("Uploaded 1 file")).toHaveCount(0);

    await expect(other.getByRole("progressbar", { name: `Upload of ${name}` })).toBeVisible({
      timeout: 30_000,
    });
    await expect(status(other, WAITING)).toHaveCount(1);

    const uploadsEntry = other.locator(".menu-item", { hasText: "Uploads" });
    await expect(uploadsEntry).toContainText("1");
    await uploadsEntry.click();
    const row = other.locator(".drive-uploads__row", { hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Uploading to Personal" })).toBeVisible();
    await expect(row.getByRole("button", { name: `Remove ${name}` })).toBeVisible();

    await goOnlineAgain(page);
    await markOffline(other, false);
    await expect(other.getByText("All uploads are done")).toBeVisible({ timeout: 60_000 });
    await other.getByRole("button", { name: "Go to Personal" }).click();
    await expect(other.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(other.locator(".menu-item", { hasText: "Uploads" })).toHaveCount(0);

    await expect(page.getByText("Uploaded 1 file")).toBeVisible({ timeout: 60_000 });
    await expectOnServerOnce(page, name);
  });

  test("cancelling a queued upload removes it and it never reaches the server", async ({
    page,
  }) => {
    const name = uniqueName("cancel");
    await openMyDrive(page);

    await goOfflineKeepingShell(page);
    await pickFile(page, name);
    await expect(status(page, WAITING)).toHaveCount(1);

    const tile = page
      .getByText(name, { exact: true })
      .locator("xpath=ancestor::*[.//button[@aria-label='More actions']][1]");
    await tile.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);

    await goOnlineAgain(page);
    // Give a stray upload time to arrive before asserting it did not.
    await page.waitForTimeout(5_000);
    expect(await serverNames(page)).not.toContain(name);
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });
});
