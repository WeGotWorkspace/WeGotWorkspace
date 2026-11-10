import { expect, test, type Page } from "./helpers/live-test";
import {
  cachedDocsViews,
  docsHomeRow,
  gotoDocsHome,
  loginToDocs,
  myDriveDocSearchPath,
  seedDocAtPath,
} from "./helpers/docs-live";
import { deleteDriveFile } from "./helpers/drive-seed";

const ID_URL = /[?&]id=(fn-[0-9a-f]{32})/;

async function nodeIdAtPath(page: Page, apiPath: string): Promise<string> {
  return page.evaluate(async (path) => {
    const token = localStorage.getItem("wgw.api.access_token");
    const response = await fetch(`/api/v1/files/node?path=${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return ((await response.json()) as { data: { id: string } }).data.id;
  }, apiPath);
}

test.describe("Docs home cached row (live app)", () => {
  test("a cached row opened before the live listing lands opens the id the server names", async ({
    page,
  }) => {
    const stamp = Date.now();
    const fileName = `e2e-cached-${stamp}.md`;
    const apiPath = `/${myDriveDocSearchPath(fileName)}`;
    await loginToDocs(page);
    await seedDocAtPath(apiPath, `# Old ${stamp}\n\nOld body.\n`);
    await gotoDocsHome(page);
    await expect(docsHomeRow(page, fileName)).toBeVisible({ timeout: 30_000 });
    // Let the live listing finish writing the offline cache.
    await expect
      .poll(
        async () => (await cachedDocsViews(page)).some((view) => view.includes(apiPath.slice(1))),
        {
          timeout: 30_000,
        },
      )
      .toBe(true);
    const oldId = await nodeIdAtPath(page, apiPath);

    await deleteDriveFile(apiPath);
    await seedDocAtPath(apiPath, `# New ${stamp}\n\nReplacement body.\n`);
    const newId = await nodeIdAtPath(page, apiPath);
    expect(newId).not.toBe(oldId);

    // Hold the live listing back so the cached row is all Docs home has.
    await page.route("**/api/v1/search/results**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      await route.continue();
    });
    await page.reload();
    const row = docsHomeRow(page, fileName);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.dblclick();

    await expect(page).toHaveURL(ID_URL, { timeout: 30_000 });
    expect(ID_URL.exec(page.url())?.[1]).toBe(newId);
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  });
});
