// Save a Word file in Drive as a Markdown Doc (#1983), live app and API.
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "./helpers/live-test";
import { putDriveFile } from "./helpers/drive-seed";
import { docsHomeRow, gotoDocsHome } from "./helpers/docs-live";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FIXTURES = join(process.cwd(), "src/docs-core/src/docx-import/__tests__/fixtures");
const readDocxFixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));
const REPORT_TITLE = "Some parts did not come across";

async function seedDocx(name: string, bytes: Uint8Array): Promise<void> {
  await putDriveFile(`/users/${E2E_USERNAME}/${name}`, bytes, DOCX);
}

async function driveFileText(name: string): Promise<string | null> {
  const response = await fetch(`${API}/files/users/${E2E_USERNAME}/${encodeURIComponent(name)}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`,
    },
  });
  return response.ok ? await response.text() : null;
}

async function openDrive(page: Page, fileName: string) {
  await page.goto("/drive");
  await page.getByRole("button", { name: "List view" }).click();
  const row = page.locator(".drive-list-row", { hasText: fileName });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible();
  return row;
}

async function openMenu(row: ReturnType<Page["locator"]>, page: Page) {
  await row.getByRole("button", { name: "More actions" }).click();
  return page.getByRole("menuitem", { name: "Save as Markdown" });
}

test.describe("Save as Markdown (live app)", () => {
  test.describe.configure({ timeout: 180_000 });

  test("converts, shows the report once, keeps both, refuses a fake .docx", async ({ page }) => {
    const stamp = Date.now();
    const reportName = `e2e-report-${stamp}.docx`;
    const logoName = `e2e-logo-${stamp}.docx`;
    const fakeName = `e2e-fake-${stamp}.docx`;
    await seedDocx(reportName, readDocxFixture("report.docx"));
    await seedDocx(logoName, readDocxFixture("image-link.docx"));
    await seedDocx(fakeName, new TextEncoder().encode("this is not a zip file"));

    // An image comes across as a Drive attachment, not an inline data URL.
    let row = await openDrive(page, logoName);
    await (await openMenu(row, page)).click();
    await expect(page.locator(".ProseMirror")).toContainText("Our logo:", { timeout: 60_000 });
    const src = await page.locator(".ProseMirror img").first().getAttribute("src");
    expect(src ?? "").not.toMatch(/^data:/);
    const logoMarkdown = await driveFileText(`e2e-logo-${stamp}.md`);
    expect(logoMarkdown).toContain("drive:fn-");

    // The report shows once; after a reload it does not come back.
    row = await openDrive(page, reportName);
    await (await openMenu(row, page)).click();
    await expect(page.locator(".ProseMirror")).toContainText("Project plan", { timeout: 60_000 });
    const dialog = page.getByRole("dialog", { name: REPORT_TITLE });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "OK" }).first().click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.locator(".ProseMirror")).toContainText("Project plan", { timeout: 60_000 });
    await expect(page.getByRole("dialog", { name: REPORT_TITLE })).toHaveCount(0);

    // A second run keeps both; the first .md is untouched.
    const first = await driveFileText(`e2e-report-${stamp}.md`);
    expect(first).toContain("Project plan");
    row = await openDrive(page, reportName);
    await (await openMenu(row, page)).click();
    await expect(page.locator(".ProseMirror")).toContainText("Project plan", { timeout: 60_000 });
    expect(await driveFileText(`e2e-report-${stamp} (1).md`)).toContain("Project plan");
    expect(await driveFileText(`e2e-report-${stamp}.md`)).toBe(first);

    // A file that is not a zip is refused and nothing is created.
    row = await openDrive(page, fakeName);
    await (await openMenu(row, page)).click();
    await expect(page.getByText("This file is not a Word document.")).toBeVisible({
      timeout: 30_000,
    });
    expect(await driveFileText(`e2e-fake-${stamp}.md`)).toBeNull();
  });

  test("offline: disabled with the reason in Drive and Docs, works again online", async ({
    page,
  }) => {
    const stamp = Date.now();
    const name = `e2e-offline-${stamp}.docx`;
    await seedDocx(name, readDocxFixture("headings.docx"));

    const row = await openDrive(page, name);
    await page.context().setOffline(true);
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 30_000 });
    const item = await openMenu(row, page);
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(/Needs a connection/)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.context().setOffline(false);
    await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 30_000 });
    await (await openMenu(row, page)).click();
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 60_000 });
    expect(await driveFileText(`e2e-offline-${stamp}.md`)).not.toBeNull();
    expect(await driveFileText(name)).not.toBeNull();

    // The Docs list offers the same action on this Word file in the own drive.
    await gotoDocsHome(page);
    const docsRow = docsHomeRow(page, name);
    await expect(docsRow).toBeVisible({ timeout: 30_000 });
    await page.context().setOffline(true);
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 30_000 });
    const docsItem = await openMenu(docsRow, page);
    await expect(docsItem).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(/Needs a connection/)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.context().setOffline(false);
  });
});
