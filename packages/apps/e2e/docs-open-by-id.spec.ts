import { expect, test, type Page } from "@playwright/test";
import {
  appendToActiveDocBody,
  blockReachabilityAndApi,
  docTokenOnServer,
  docsUrlForFile,
  expectEditorContains,
  loginToDocs,
  myDriveDocSearchPath,
  restoreNetwork,
  seedDocAtPath,
  waitForDocSaved,
} from "./helpers/docs-live";
import { moveDriveFile } from "./helpers/drive-seed";

/** Docs names the open file by its FileNode id, so links survive a rename or move (#1751). */
const ID_URL = /[?&]id=(fn-[0-9a-f]{32})/;

async function openByPathAndReadId(page: Page, apiPath: string): Promise<string> {
  await page.goto(docsUrlForFile(apiPath));
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(ID_URL, { timeout: 30_000 });
  const id = ID_URL.exec(page.url())?.[1];
  expect(id).toBeTruthy();
  return id as string;
}

async function showTabAgain(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

test.describe("Docs open by id (live app)", () => {
  test("a path link becomes an id link that still opens after a rename", async ({ page }) => {
    const stamp = Date.now();
    const apiPath = `/${myDriveDocSearchPath(`e2e-byid-${stamp}.md`)}`;
    const renamed = `/${myDriveDocSearchPath(`e2e-byid-${stamp}-renamed.md`)}`;
    await loginToDocs(page);
    await seedDocAtPath(apiPath, `# By id ${stamp}\n\nFirst body.\n`);

    const id = await openByPathAndReadId(page, apiPath);
    await expectEditorContains(page, `By id ${stamp}`);

    await moveDriveFile(apiPath, renamed);
    await page.goto(`/docs?id=${id}`);
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
    await expectEditorContains(page, `By id ${stamp}`);
    await expect(page).toHaveTitle(/renamed/, { timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`id=${id}`));
  });

  test("an open doc follows a rename made elsewhere", async ({ page }) => {
    const stamp = Date.now();
    const apiPath = `/${myDriveDocSearchPath(`e2e-follow-${stamp}.md`)}`;
    const moved = `/${myDriveDocSearchPath(`e2e-follow-${stamp}-moved.md`)}`;
    await loginToDocs(page);
    await seedDocAtPath(apiPath, `# Follow ${stamp}\n\nBody.\n`);
    const id = await openByPathAndReadId(page, apiPath);

    await moveDriveFile(apiPath, moved);
    await showTabAgain(page);

    await expect(page).toHaveTitle(/moved/, { timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`id=${id}`));
    await expectEditorContains(page, `Follow ${stamp}`);

    const token = `after-move-${stamp}`;
    await appendToActiveDocBody(page, ` ${token}`);
    await waitForDocSaved(page, moved, token);
    expect(await docTokenOnServer(page, apiPath, token)).toBe(false);
  });

  test("typing while someone else renames keeps the text on the renamed file", async ({ page }) => {
    const stamp = Date.now();
    const apiPath = `/${myDriveDocSearchPath(`e2e-typing-${stamp}.md`)}`;
    const moved = `/${myDriveDocSearchPath(`e2e-typing-${stamp}-moved.md`)}`;
    await loginToDocs(page);
    await seedDocAtPath(apiPath, `# Typing ${stamp}\n\nBody.\n`);
    await openByPathAndReadId(page, apiPath);

    await moveDriveFile(apiPath, moved);
    const token = `typed-during-move-${stamp}`;
    await appendToActiveDocBody(page, ` ${token}`);

    await expect(page).toHaveTitle(/moved/, { timeout: 30_000 });
    await waitForDocSaved(page, moved, token);
  });

  test("a second tab opens the id link at the new path", async ({ page, context }) => {
    const stamp = Date.now();
    const apiPath = `/${myDriveDocSearchPath(`e2e-tab-${stamp}.md`)}`;
    const moved = `/${myDriveDocSearchPath(`e2e-tab-${stamp}-moved.md`)}`;
    await loginToDocs(page);
    await seedDocAtPath(apiPath, `# Tab ${stamp}\n\nBody.\n`);
    const id = await openByPathAndReadId(page, apiPath);
    await moveDriveFile(apiPath, moved);

    const second = await context.newPage();
    await second.goto(`/docs?id=${id}`);
    await expect(second.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
    await expect(second).toHaveTitle(/moved/, { timeout: 30_000 });
    await expectEditorContains(second, `Tab ${stamp}`);
    await second.close();
  });

  test("an unknown id shows not found with a way back", async ({ page }) => {
    await loginToDocs(page);
    await page.goto(`/docs?id=fn-${"0".repeat(32)}`);
    await expect(page.getByText("This document could not be found")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Go to Docs" }).click();
    await expect(page.locator(".docs-home-pane")).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/[?&]id=/);
  });

  test("an id link reopens from the cache while the server is unreachable", async ({ page }) => {
    const stamp = Date.now();
    const apiPath = `/${myDriveDocSearchPath(`e2e-offline-${stamp}.md`)}`;
    await loginToDocs(page);
    await seedDocAtPath(apiPath, `# Offline ${stamp}\n\nBody.\n`);
    const id = await openByPathAndReadId(page, apiPath);
    await expectEditorContains(page, `Offline ${stamp}`);

    await blockReachabilityAndApi(page);
    await page.goto(`/docs?id=${id}`);
    await expect(
      page.locator(".ProseMirror").or(page.getByText("This document is not available offline")),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await expectEditorContains(page, `Offline ${stamp}`);
    await restoreNetwork(page);
  });
});
