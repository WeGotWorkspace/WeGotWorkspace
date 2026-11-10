import { expect, test, type Page } from "./helpers/live-test";
import {
  appendToActiveDocBody,
  blockReachabilityAndApi,
  docsHomeRow,
  docTokenOnServer,
  docsUrlForFile,
  expectEditorContains,
  gotoDocsHome,
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

  test("a Docs home row opens straight by id, without a path lookup", async ({ page }) => {
    const stamp = Date.now();
    const fileName = `e2e-row-${stamp}.md`;
    const apiPath = `/${myDriveDocSearchPath(fileName)}`;
    await loginToDocs(page);
    await seedDocAtPath(apiPath, `# Row ${stamp}\n\nOpened from the list.\n`);
    await gotoDocsHome(page);
    const row = docsHomeRow(page, fileName);
    await expect(row).toBeVisible({ timeout: 30_000 });

    const nodeLookups: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/api/v1/files/node")) {
        nodeLookups.push(request.url());
      }
    });
    // Record every route URL the SPA sets and whether the wait screen ever shows (#1976).
    await page.evaluate((waitSelector) => {
      const w = window as unknown as { __docsUrls: string[]; __sawOpening: boolean };
      w.__docsUrls = [];
      w.__sawOpening = false;
      for (const method of ["pushState", "replaceState"] as const) {
        const original = history[method].bind(history);
        history[method] = (data, unused, url) => {
          if (url) w.__docsUrls.push(String(url));
          original(data, unused, url);
        };
      }
      // The "Opening document…" frame; its text stays hidden for the first 400 ms.
      new MutationObserver(() => {
        if (document.querySelector(waitSelector)) w.__sawOpening = true;
      }).observe(document.body, { childList: true, subtree: true });
    }, ".docs-route-status--loading");

    await row.dblclick();

    await expect(page).toHaveURL(ID_URL, { timeout: 30_000 });
    await expectEditorContains(page, `Row ${stamp}`);
    const { urls, sawOpening } = await page.evaluate(() => {
      const w = window as unknown as { __docsUrls: string[]; __sawOpening: boolean };
      return { urls: w.__docsUrls, sawOpening: w.__sawOpening };
    });
    const docsUrls = urls.filter((url) => url.includes("/docs?"));
    expect(docsUrls[0]).toMatch(ID_URL);
    expect(docsUrls.some((url) => url.includes("file="))).toBe(false);
    expect(sawOpening).toBe(false);
    expect(nodeLookups).toEqual([]);
  });

  test("a row still opens by id after another tab refreshes the list from the cache", async ({
    page,
    context,
  }) => {
    const stamp = Date.now();
    const fileName = `e2e-refresh-${stamp}.md`;
    const laterName = `e2e-refresh-later-${stamp}.md`;
    await loginToDocs(page);
    await seedDocAtPath(`/${myDriveDocSearchPath(fileName)}`, `# Refresh ${stamp}\n\nBody.\n`);
    await gotoDocsHome(page);
    await expect(docsHomeRow(page, fileName)).toBeVisible({ timeout: 30_000 });

    // Tab B: wait until its live listings (rows with ids) have landed and no
    // other listing request followed for a while.
    const tabB = await context.newPage();
    const isSearch = (url: string) => new URL(url).pathname.endsWith("/api/v1/search/results");
    let searchesInFlight = 0;
    let lastSearchAt = 0;
    tabB.on("request", (request) => {
      if (!isSearch(request.url())) return;
      searchesInFlight += 1;
      lastSearchAt = Date.now();
    });
    for (const event of ["requestfinished", "requestfailed"] as const) {
      tabB.on(event, (request) => {
        if (!isSearch(request.url())) return;
        searchesInFlight -= 1;
        lastSearchAt = Date.now();
      });
    }
    await gotoDocsHome(tabB);
    await expect(docsHomeRow(tabB, fileName)).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => lastSearchAt > 0 && searchesInFlight === 0 && Date.now() - lastSearchAt > 2_000, {
        timeout: 30_000,
      })
      .toBe(true);

    // Tab A lists a new Doc, rewrites the cache and tells tab B, whose list
    // now comes from cached rows. Cached rows carry no id (#1976).
    await seedDocAtPath(`/${myDriveDocSearchPath(laterName)}`, `# Later ${stamp}\n`);
    await page.reload();
    await expect(docsHomeRow(page, laterName)).toBeVisible({ timeout: 30_000 });
    await expect(docsHomeRow(tabB, laterName)).toBeVisible({ timeout: 30_000 });

    const nodeLookups: string[] = [];
    tabB.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/api/v1/files/node")) {
        nodeLookups.push(request.url());
      }
    });
    await docsHomeRow(tabB, fileName).dblclick();

    await expect(tabB).toHaveURL(ID_URL, { timeout: 30_000 });
    await expectEditorContains(tabB, `Refresh ${stamp}`);
    expect(nodeLookups).toEqual([]);
    await tabB.close();
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
