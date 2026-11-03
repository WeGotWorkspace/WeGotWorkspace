import { expect, test, type Page } from "./helpers/live-test";
import {
  GONE,
  goOfflineKeepingShell,
  goOnlineAgain,
  installOnlineFlag,
  namesIn,
  openMyDrive,
  openUploads,
  pickFile,
  queueIntoFolder,
  trashFolderOnServer,
  uniqueName,
  uploadInput,
  uploadRow,
} from "./helpers/drive-upload-live";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const SERVER_FULL_TITLE = "Uploads are paused: the server is full";

async function countOnServer(page: Page, file: string): Promise<number> {
  return (await namesIn(page, "")).filter((name) => name === file).length;
}

/** Closes `page` as a user would and returns whether the browser asked first. */
async function closeAsksToLeave(page: Page): Promise<boolean> {
  // Chrome shows the prompt only for a page the user has interacted with.
  await page.mouse.click(2, 2);
  const asked = page
    .waitForEvent("dialog", { timeout: 3_000 })
    .then(async (dialog) => {
      await dialog.dismiss();
      return dialog.type() === "beforeunload";
    })
    .catch(() => false);
  // With `runBeforeUnload` the call returns without waiting for the page to close.
  await page.close({ runBeforeUnload: true });
  return asked;
}

test.describe("Drive upload recovery (live app)", () => {
  test.beforeEach(async ({ context }) => {
    await installOnlineFlag(context);
  });

  test("Choose another folder sends a file whose folder is gone to My Drive once", async ({
    page,
  }) => {
    const folder = uniqueName("choose");
    const file = `${uniqueName("choose-file")}.txt`;
    const other = await queueIntoFolder(page, folder, file);

    await trashFolderOnServer(other, folder);
    await goOnlineAgain(page);
    await openUploads(page);
    await expect(uploadRow(page, file)).toContainText(GONE, { timeout: 60_000 });
    await openUploads(other);
    await expect(uploadRow(other, file)).toContainText(GONE, { timeout: 60_000 });

    await uploadRow(page, file)
      .getByRole("button", { name: `Choose another folder: ${file}` })
      .click();
    // The picker opens at the root of the personal drive: My Drive.
    await page.getByRole("dialog").getByRole("button", { name: "Upload here" }).click();

    await expect.poll(() => countOnServer(other, file), { timeout: 60_000 }).toBe(1);
    await expect(other.locator(".drive-uploads__row")).toHaveCount(0, { timeout: 60_000 });

    await page.reload();
    await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
    await expect(page.locator(".drive-uploads__row--failed")).toHaveCount(0);
    await expect(page.locator(".drive-uploads__row")).toHaveCount(0);
    expect(await countOnServer(other, file)).toBe(1);
  });

  test("a full server shows the callout and the pause sign, and the callout's Retry resumes", async ({
    page,
  }) => {
    const first = `${uniqueName("pause-1")}.txt`;
    const second = `${uniqueName("pause-2")}.txt`;
    await openMyDrive(page);
    const other = await page.context().newPage();
    await openMyDrive(other);

    await page.context().route("**/jmap/upload**", (route) =>
      route.fulfill({
        status: 507,
        contentType: "application/problem+json",
        body: JSON.stringify({ type: "urn:ietf:params:jmap:error:overQuota", status: 507 }),
      }),
    );
    await uploadInput(page).setInputFiles([
      { name: first, mimeType: "text/plain", buffer: Buffer.from("first") },
      { name: second, mimeType: "text/plain", buffer: Buffer.from("second") },
    ]);

    for (const tab of [page, other]) {
      const entry = tab.getByRole("button", { name: /^Uploads/ });
      await expect(entry).toContainText("paused, the server is full", { timeout: 60_000 });
      await openUploads(tab);
      await expect(tab.getByText(SERVER_FULL_TITLE)).toBeVisible();
    }

    await page.context().unroute("**/jmap/upload**");
    await page
      .locator(".drive-uploads__paused")
      .getByRole("button", { name: "Retry", exact: true })
      .click();

    await expect
      .poll(
        async () => {
          const names = await namesIn(page, "");
          return [first, second].map((name) => names.filter((n) => n === name).length);
        },
        { timeout: 90_000 },
      )
      .toEqual([1, 1]);
    await expect(other.getByText(SERVER_FULL_TITLE)).toHaveCount(0, { timeout: 60_000 });
  });

  test("closing the last tab asks first, also after leaving Drive, and not when another Drive tab carries on", async ({
    page,
  }) => {
    const file = `${uniqueName("leave")}.txt`;
    await openMyDrive(page);

    let held = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.context().route("**/jmap/upload**", async (route) => {
      held += 1;
      await gate;
      await route.fallback();
    });
    await pickFile(page, file);
    await expect.poll(() => held, { timeout: 60_000 }).toBeGreaterThan(0);
    // Let the lock poll settle: this is the only Drive tab.
    await page.waitForTimeout(3_500);
    expect(await closeAsksToLeave(page)).toBe(true);
    expect(page.isClosed()).toBe(false);

    // The uploader outlives the Drive view: the warning does too.
    await page.getByRole("button", { name: "Drive, switch apps" }).click();
    await page.getByRole("menuitem", { name: /^Notes/ }).click();
    await expect(page).toHaveURL(/\/notes/, { timeout: 30_000 });
    await expect(uploadInput(page)).toHaveCount(0);
    await page.waitForTimeout(3_500);
    expect(await closeAsksToLeave(page)).toBe(true);

    // Back in Drive, with a second Drive tab waiting on the lock.
    await page.getByRole("button", { name: /switch apps/ }).click();
    await page.getByRole("menuitem", { name: /^Drive/ }).click();
    await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
    const tabB = await page.context().newPage();
    await openMyDrive(tabB);
    await page.waitForTimeout(3_500);
    expect(await closeAsksToLeave(page)).toBe(false);
    expect(page.isClosed()).toBe(true);

    release?.();
    await expect.poll(() => countOnServer(tabB, file), { timeout: 90_000 }).toBe(1);
  });

  test("closing a tab with waiting files, offline, does not ask", async ({ page }) => {
    const file = `${uniqueName("offline-leave")}.txt`;
    await openMyDrive(page);
    await goOfflineKeepingShell(page);
    await pickFile(page, file);
    await expect(page.getByText(file, { exact: true })).toBeVisible();
    await page.waitForTimeout(3_500);
    // The file is stored on the device, so the next Drive tab goes on with it.
    expect(await closeAsksToLeave(page)).toBe(false);
  });

  for (const choice of ["Wait", "Sign out anyway"] as const) {
    test(`signing out with a file waiting: ${choice}`, async ({ page }) => {
      const file = `${uniqueName("signout")}.txt`;
      await openMyDrive(page);
      await goOfflineKeepingShell(page);
      await pickFile(page, file);
      await expect(page.getByText(file, { exact: true })).toBeVisible();

      await page.goto("/logout");
      await expect(page.getByText("Uploads are not finished")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/1 file is still waiting to upload/)).toBeVisible();

      if (choice === "Wait") {
        await page.getByRole("button", { name: "Wait" }).click();
        await expect(page).toHaveURL(/\/drive\?view=uploads/, { timeout: 30_000 });
        await expect(uploadRow(page, file)).toBeVisible({ timeout: 30_000 });
        await goOnlineAgain(page);
        await expect.poll(() => countOnServer(page, file), { timeout: 90_000 }).toBe(1);
      } else {
        await page.getByRole("button", { name: "Sign out anyway" }).click();
        await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
        // The wipe is done; the sign-in below needs the network back.
        await page.context().unrouteAll({ behavior: "ignoreErrors" });
        await page.evaluate(() => sessionStorage.removeItem("e2e-offline"));
        await page.getByLabel("Username").fill(E2E_USERNAME);
        await page.locator("#password").fill(E2E_PASSWORD);
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
        await openMyDrive(page);
        expect(await namesIn(page, "")).not.toContain(file);
      }
    });
  }

  test("Retry on an auth failure signs in again and the file uploads once", async ({ page }) => {
    const file = `${uniqueName("auth")}.txt`;
    await openMyDrive(page);

    const unauthorized = (route: import("@playwright/test").Route) =>
      route.fulfill({
        status: 401,
        contentType: "application/problem+json",
        body: JSON.stringify({ status: 401, title: "Unauthorized" }),
      });
    await page.context().route("**/jmap/upload**", unauthorized);
    await page.context().route("**/auth/refresh**", unauthorized);
    await pickFile(page, file);

    await openUploads(page);
    await expect(uploadRow(page, file)).toContainText("Sign in again to upload", {
      timeout: 60_000,
    });
    await expect(uploadRow(page, file)).toContainText("Retry takes you to sign in");

    await page.context().unrouteAll({ behavior: "ignoreErrors" });
    await uploadRow(page, file)
      .getByRole("button", { name: `Retry ${file}` })
      .click();
    await expect(page).toHaveURL(/\/login\?return=%2Fdrive%3Fview%3Duploads/, {
      timeout: 30_000,
    });

    await page.getByLabel("Username").fill(E2E_USERNAME);
    await page.locator("#password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/drive\?view=uploads|\/drive.*view=uploads/, {
      timeout: 30_000,
    });
    await expect.poll(() => countOnServer(page, file), { timeout: 90_000 }).toBe(1);
  });
});
