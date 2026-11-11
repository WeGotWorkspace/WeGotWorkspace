// Notes Markdown import (live app and API, #1623).
//
// Two files go into a new notebook: one with front matter, a paragraph and an
// inline PNG (uploaded to Drive), one that is only whitespace (skipped). The
// note shows in the list, in a reload, and in a second tab without a manual
// refresh. Offline, the menu item is disabled and opens no picker. Going
// offline with the dialog open disables Import, and no notebook is made.
import { expect, test } from "./helpers/live-test";
import { prepareNotesForOfflineSync } from "./helpers/notes-live";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

test.describe("Notes Markdown import (live app)", () => {
  test.describe.configure({ timeout: 180_000 });

  test("imports a note with tags and an image, and other tabs see it", async ({ page }) => {
    const stamp = Date.now();
    const title = `Trip ${stamp}`;
    const token = `e2e-import-${stamp}`;
    const notebookName = `Imported ${stamp}`;

    await prepareNotesForOfflineSync(page);
    await page.getByRole("button", { name: "More create options" }).click();
    const fileChooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Import Markdown files" }).click();
    await (
      await fileChooser
    ).setFiles([
      {
        name: "trip.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          `---\ntitle: ${title}\ntags: [travel]\n---\n\nPacking list ${token}\n\n![dot](data:image/png;base64,${PNG_1PX})\n\n![pic](pic.png)\n`,
        ),
      },
      { name: "empty.md", mimeType: "text/markdown", buffer: Buffer.from("  \n") },
    ]);

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("2 files selected")).toBeVisible();
    await dialog.getByRole("combobox", { name: "Notebook" }).click();
    await page.getByRole("option", { name: /Create notebook|New notebook/i }).click();
    await dialog.getByLabel("Notebook name").fill(notebookName);
    await dialog.getByRole("button", { name: "Import", exact: true }).click();

    await expect(dialog.getByText("Imported 1 note")).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByText("empty.md")).toBeVisible();
    await expect(dialog.getByText("File is empty")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    const row = page.locator(".list-item__button", { hasText: title });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText(token, { timeout: 20_000 });
    await expect(page.getByText("travel").first()).toBeVisible();
    const image = editor.locator("img").first();
    await expect(image).toHaveJSProperty("complete", true, { timeout: 20_000 });
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);

    // A second tab of the same account gets the final note, not the empty create.
    const other = await page.context().newPage();
    await other.goto("/notes");
    await expect(other.locator(".list-item__button", { hasText: title })).toBeVisible({
      timeout: 30_000,
    });
    await other.locator(".list-item__button", { hasText: title }).click();
    await expect(other.locator(".ProseMirror")).toContainText(token, { timeout: 20_000 });
    await other.close();

    await page.reload();
    await page.locator(".list-item__button", { hasText: title }).click();
    await expect(page.locator(".ProseMirror")).toContainText(token, { timeout: 20_000 });
    await expect
      .poll(
        () =>
          page
            .locator(".ProseMirror img")
            .first()
            .evaluate((img: HTMLImageElement) => img.naturalWidth),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
  });

  test("offline: the menu item is disabled and opens no picker", async ({ page }) => {
    await prepareNotesForOfflineSync(page);
    await page.context().setOffline(true);
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "More create options" }).click();
    const item = page.getByRole("menuitem", { name: /Import Markdown files/ });
    await expect(item).toBeDisabled();
    await expect(item).toContainText("Needs a connection");
    let opened = false;
    page.on("filechooser", () => (opened = true));
    await item.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500);
    expect(opened).toBe(false);
    await page.context().setOffline(false);
  });

  test("offline with the dialog open: Import is disabled and no notebook is made", async ({
    page,
  }) => {
    const notebookName = `Offline import ${Date.now()}`;

    await prepareNotesForOfflineSync(page);
    await page.getByRole("button", { name: "More create options" }).click();
    const fileChooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Import Markdown files" }).click();
    await (
      await fileChooser
    ).setFiles([{ name: "a.md", mimeType: "text/markdown", buffer: Buffer.from("# A\n") }]);

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Notebook" }).click();
    await page.getByRole("option", { name: /Create notebook|New notebook/i }).click();
    await dialog.getByLabel("Notebook name").fill(notebookName);

    await page.context().setOffline(true);
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 15_000 });
    const submit = dialog.getByRole("button", { name: "Import", exact: true });
    await expect(submit).toBeDisabled();
    await expect(dialog.getByText("Importing notes needs an internet connection")).toBeVisible();
    await submit.click({ force: true }).catch(() => undefined);

    await page.context().setOffline(false);
    await expect(page.locator('[data-connectivity="offline"]')).toHaveCount(0, {
      timeout: 15_000,
    });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "More create options" })).toBeVisible({
      timeout: 30_000,
    });

    const names = await page.evaluate(async () => {
      const accessToken = localStorage.getItem("wgw.api.access_token");
      const response = await fetch("/api/v1/notes/notebooks", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = (await response.json()) as { list?: { name: string }[] };
      return (body.list ?? []).map((notebook) => notebook.name);
    });
    expect(names).not.toContain(notebookName);
    await expect(page.getByText(notebookName)).toHaveCount(0);
  });
});
