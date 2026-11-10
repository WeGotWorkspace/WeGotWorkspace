import { expect, test, type Page } from "./helpers/live-test";
import { E2E_USERNAME } from "./helpers/notes-live";

const TITLE = "A file with this name already exists";
const WAITING = "Waiting for your answer";

function uploadInput(page: Page) {
  return page.locator('input[type="file"][aria-label="Upload files"]');
}

async function openMyDrive(page: Page): Promise<void> {
  await page.goto("/drive?view=folder&path=My%20Drive");
  await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Loading folder…")).toHaveCount(0, { timeout: 30_000 });
  // The folder listing is written to the offline cache just after it paints.
  await page.waitForTimeout(3_000);
}

async function pickFile(page: Page, name: string): Promise<void> {
  await uploadInput(page).setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(`drive upload batch dialog ${name}`),
  });
}

function dialog(page: Page) {
  return page.getByRole("dialog", { name: TITLE });
}

function status(page: Page, text: string) {
  return page.locator(".drive-upload-status", { hasText: text });
}

async function serverNames(page: Page): Promise<string[]> {
  return page.evaluate(async (username) => {
    const token = localStorage.getItem("wgw.api.access_token");
    const response = await fetch(
      `/api/v1/files/children?path=${encodeURIComponent(`/users/${username}`)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error(`Listing failed (${response.status})`);
    const payload = (await response.json()) as { data: { files: { name: string }[] } };
    return payload.data.files.map((file) => file.name);
  }, E2E_USERNAME);
}

async function expectCounts(page: Page, name: string, expected: [number, number]): Promise<void> {
  const copy = name.replace(/\.txt$/, " (1).txt");
  await expect
    .poll(
      async () => {
        const names = await serverNames(page);
        return [names.filter((n) => n === name).length, names.filter((n) => n === copy).length];
      },
      { timeout: 60_000 },
    )
    .toEqual(expected);
}

/** Uploads `name`, waits for it on the server, then picks it again so the dialog opens. */
async function uploadThenPickAgain(page: Page, name: string): Promise<void> {
  await openMyDrive(page);
  await pickFile(page, name);
  await expectCounts(page, name, [1, 0]);
  await expect(page.locator(".drive-upload-status")).toHaveCount(0, { timeout: 60_000 });
  // Let the listing show the file, so the conflict check knows the name.
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await pickFile(page, name);
  await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
}

/** Steps through the dialog's questions (the conflict step keeps *Keep both*) and uploads. */
async function pressUpload(page: Page): Promise<void> {
  const next = dialog(page).getByRole("button", { name: "Next" });
  while (await next.isVisible().catch(() => false)) await next.click();
  await dialog(page).getByRole("button", { name: "Upload", exact: true }).click();
}

test.describe("Drive upload batch dialog (live app)", () => {
  test("a reload with the dialog open asks again; Keep both uploads one copy", async ({ page }) => {
    const name = `e2e-batch-keep-${Date.now()}.txt`;
    await uploadThenPickAgain(page, name);
    await expect(status(page, WAITING)).toHaveCount(1);

    await page.reload();
    await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
    await expect(dialog(page)).toBeVisible({ timeout: 60_000 });
    await expect(dialog(page).getByRole("radio", { name: /Keep both/ })).toBeChecked();

    await pressUpload(page);
    await expect(dialog(page)).toHaveCount(0);
    await expectCounts(page, name, [1, 1]);
    // An explicit *Keep both* is the user's choice: no "kept both" notice follows.
    await expect(page.getByRole("region", { name: "Upload notices" })).toHaveCount(0);
  });

  test("Cancel drops the placeholder and nothing new reaches the server", async ({ page }) => {
    const name = `e2e-batch-cancel-${Date.now()}.txt`;
    await uploadThenPickAgain(page, name);
    await expect(status(page, WAITING)).toHaveCount(1);

    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, WAITING)).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(5_000);
    await expectCounts(page, name, [1, 0]);
  });

  test("a second tab shows the placeholder without a dialog, then the file without a reload", async ({
    page,
  }) => {
    const name = `e2e-batch-tabs-${Date.now()}.txt`;
    await uploadThenPickAgain(page, name);
    const other = await page.context().newPage();
    await openMyDrive(other);

    await expect(status(other, WAITING)).toHaveCount(1, { timeout: 30_000 });
    await expect(dialog(other)).toHaveCount(0);

    await pressUpload(page);
    await expectCounts(page, name, [1, 1]);
    await expect(status(other, WAITING)).toHaveCount(0, { timeout: 60_000 });
    await expect(other.getByText(name.replace(/\.txt$/, " (1).txt"), { exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });
});
