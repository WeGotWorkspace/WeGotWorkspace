import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";

function uploadInput(page: Page) {
  return page.locator('input[type="file"][aria-label="Upload files"]');
}

/** Creates a folder over WebDAV as the e2e user (the app itself writes through JMAP). */
async function makeDriveFolder(name: string): Promise<void> {
  const response = await fetch(`${API}/files/users/${E2E_USERNAME}/${encodeURIComponent(name)}`, {
    method: "MKCOL",
    headers: {
      Authorization: `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`,
    },
  });
  if (!response.ok) throw new Error(`MKCOL ${name} failed (${response.status})`);
}

async function openFolderShareDialog(page: Page, folder: string) {
  await page.goto("/drive");
  const tile = page
    .getByText(folder, { exact: true })
    .locator("xpath=ancestor::*[.//button[@aria-label='More actions']][1]");
  await tile.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`Share ${folder}`) });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

test.describe("Drive guest upload (live app)", () => {
  test("a guest adds a file through a Can add files link, across a reload", async ({
    page,
    browser,
  }) => {
    const folder = `e2e-guest-drop-${Date.now()}`;
    const fileName = "guest-note.txt";
    const content = `guest upload ${Date.now()}`;
    await makeDriveFolder(folder);

    const dialog = await openFolderShareDialog(page, folder);
    await dialog.getByRole("switch", { name: "Enable public access" }).click();
    const linkInput = dialog.getByRole("textbox", { name: "Anyone with the link" });
    await expect(linkInput).toHaveValue(/\/share\/[^/]+$/, { timeout: 30_000 });
    const url = await linkInput.inputValue();
    const token = url.split("/share/")[1];

    // A new public link requires a password; the guest here opens it without one.
    const passwordSwitch = dialog.getByRole("switch", { name: "Require password" });
    await expect(passwordSwitch).toBeChecked({ timeout: 30_000 });
    await passwordSwitch.click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(passwordSwitch).not.toBeChecked({ timeout: 30_000 });

    const level = dialog.getByRole("combobox", { name: "People with the link" });
    await level.click();
    await page.getByRole("option", { name: "Can add files" }).click();
    await expect(level).toContainText("Can add files");

    const guestContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await guestContext.newPage();
    try {
      await guest.goto(`/share/${token}`);
      await expect(guest.getByText("Can view and add files")).toBeVisible({ timeout: 30_000 });
      await expect(uploadInput(guest)).toBeAttached();
      await expect(guest.getByRole("button", { name: "Upload files" })).toBeVisible();
      await expect(guest.getByRole("button", { name: "New folder" })).toHaveCount(0);

      // Hold the part upload so the file is still in flight when the guest reloads.
      let partHeld: () => void = () => undefined;
      const partRequested = new Promise<void>((resolve) => (partHeld = resolve));
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      await guest.route("**/jmap/guest/upload/**", async (route) => {
        partHeld();
        await held;
        await route.fallback().catch(() => undefined);
      });
      await uploadInput(guest).setInputFiles({
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from(content),
      });
      await expect(guest.getByText(fileName).first()).toBeVisible({ timeout: 30_000 });

      // Reload only once the batch is released and a part is in flight.
      await partRequested;
      await guest.unrouteAll({ behavior: "ignoreErrors" });
      release();
      await guest.reload();
      await expect(guest.getByText("Can view and add files")).toBeVisible({ timeout: 30_000 });
      await expect(guest.getByText(fileName).first()).toBeVisible({ timeout: 30_000 });

      // The member sees the file in the folder, with the picked bytes.
      const folderUrl = `/drive?path=${encodeURIComponent(`My Drive/${folder}`)}`;
      await expect
        .poll(
          async () => {
            await page.goto(folderUrl);
            await expect(page.getByText("Loading folder…")).toHaveCount(0, { timeout: 30_000 });
            return page.getByText(fileName, { exact: true }).count();
          },
          { timeout: 70_000, intervals: [2_000] },
        )
        .toBeGreaterThan(0);
      const row = page
        .getByText(fileName, { exact: true })
        .locator("xpath=ancestor::*[.//button[@aria-label='More actions']][1]");
      await row.getByRole("button", { name: "More actions" }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("menuitem", { name: "Download" }).click(),
      ]);
      expect(readFileSync(await download.path(), "utf8")).toBe(content);

      // Back to view only: the guest loses the upload button and drop target.
      const again = await openFolderShareDialog(page, folder);
      const levelAgain = again.getByRole("combobox", { name: "People with the link" });
      await levelAgain.click();
      await page.getByRole("option", { name: "Can view", exact: true }).click();
      await expect(levelAgain).toContainText("Can view");
      await expect
        .poll(
          async () => {
            await guest.reload();
            await expect(guest.getByText(fileName).first()).toBeVisible({ timeout: 30_000 });
            return uploadInput(guest).count();
          },
          { timeout: 60_000 },
        )
        .toBe(0);
      await expect(guest.getByRole("button", { name: "Upload files" })).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
});
