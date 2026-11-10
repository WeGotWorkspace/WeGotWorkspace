// Import Word file on Docs home (#1619), live app and API.
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "./helpers/live-test";
import { gotoDocsHome } from "./helpers/docs-live";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FIXTURES = join(process.cwd(), "src/docs-core/src/docx-import/__tests__/fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const REPORT_TITLE = "Some parts did not come across";
const IMPORT_TITLE = "Import Word file";

async function driveFileText(name: string): Promise<string | null> {
  const response = await fetch(`${API}/files/users/${E2E_USERNAME}/${encodeURIComponent(name)}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`,
    },
  });
  return response.ok ? await response.text() : null;
}

async function openImportMenu(page: Page) {
  await page.getByRole("button", { name: "More create options" }).click();
  return page.getByRole("menuitem", { name: IMPORT_TITLE });
}

/** Pick a file through the hidden input; the naming dialog opens. */
async function pickWordFile(page: Page, name: string, buffer: Buffer) {
  await (await openImportMenu(page)).click();
  await page
    .getByTestId("docs-import-word-file-input")
    .setInputFiles({ name, mimeType: DOCX, buffer });
  const dialog = page.getByRole("dialog", { name: IMPORT_TITLE });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("row", { name: "Personal" }).click();
  return dialog;
}

test.describe("Import Word file (live app)", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await gotoDocsHome(page);
    await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 30_000 });
  });

  test("imports with an image attachment, shows the report once, avoids a name clash", async ({
    page,
  }) => {
    const stamp = Date.now();

    const logoBase = `e2e-import-logo-${stamp}`;
    let dialog = await pickWordFile(page, `${logoBase}.docx`, fixture("image-link.docx"));
    await expect(dialog.getByPlaceholder("Name")).toHaveValue(logoBase);
    await expect(dialog.getByRole("button", { name: "Import" })).toBeVisible();
    await dialog.getByRole("button", { name: "Import" }).click();
    await expect(page.locator(".ProseMirror")).toContainText("Our logo:", { timeout: 60_000 });
    const src = await page.locator(".ProseMirror img").first().getAttribute("src");
    expect(src ?? "").not.toMatch(/^data:/);
    expect(await driveFileText(`${logoBase}.md`)).toContain("drive:fn-");
    expect(await driveFileText(`${logoBase}.docx`)).toBeNull();

    await gotoDocsHome(page);
    const reportBase = `e2e-import-report-${stamp}`;
    dialog = await pickWordFile(page, `${reportBase}.docx`, fixture("report.docx"));
    await dialog.getByRole("button", { name: "Import" }).click();
    await expect(page.locator(".ProseMirror")).toContainText("Project plan", { timeout: 60_000 });
    const report = page.getByRole("dialog", { name: REPORT_TITLE });
    await expect(report).toBeVisible({ timeout: 30_000 });
    await report.getByRole("button", { name: "OK" }).first().click();
    await expect(report).toBeHidden();
    await page.reload();
    await expect(page.locator(".ProseMirror")).toContainText("Project plan", { timeout: 60_000 });
    await expect(page.getByRole("dialog", { name: REPORT_TITLE })).toHaveCount(0);

    const first = await driveFileText(`${reportBase}.md`);
    expect(first).toContain("Project plan");
    await gotoDocsHome(page);
    dialog = await pickWordFile(page, `${reportBase}.docx`, fixture("report.docx"));
    await expect(dialog.getByPlaceholder("Name")).toHaveValue(`${reportBase} 2`);
    await dialog.getByRole("button", { name: "Import" }).click();
    await expect(page.locator(".ProseMirror")).toContainText("Project plan", { timeout: 60_000 });
    expect(await driveFileText(`${reportBase}.md`)).toBe(first);
    expect(await driveFileText(`${reportBase} 2.md`)).toContain("Project plan");
  });

  test("refuses a fake .docx and creates nothing", async ({ page }) => {
    const base = `e2e-import-fake-${Date.now()}`;
    const dialog = await pickWordFile(page, `${base}.docx`, Buffer.from("this is not a zip file"));
    await dialog.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText("This file is not a Word document.")).toBeVisible({
      timeout: 30_000,
    });
    expect(await driveFileText(`${base}.md`)).toBeNull();
  });

  test("offline: disabled with the reason, works again online", async ({ page }) => {
    await page.context().setOffline(true);
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 30_000 });
    const item = await openImportMenu(page);
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(/Needs a connection/)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.context().setOffline(false);
    await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 30_000 });
    const base = `e2e-import-online-${Date.now()}`;
    const dialog = await pickWordFile(page, `${base}.docx`, fixture("headings.docx"));
    await dialog.getByRole("button", { name: "Import" }).click();
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 60_000 });
    expect(await driveFileText(`${base}.md`)).not.toBeNull();
  });
});
