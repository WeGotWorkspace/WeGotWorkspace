import { expect, resetApiBudgetAfterSetup, test, type Page } from "./helpers/live-test";
import {
  docsHomeRow,
  docsUrlForFile,
  E2E_USERNAME,
  gotoDocsHome,
  loginToDocs,
  myDriveDocSearchPath,
  seedDocAtPath,
} from "./helpers/docs-live";
import { deleteDriveFile, seedDriveFolder } from "./helpers/drive-seed";

test.describe("Docs home browse (live app)", () => {
  test("uploaded My Drive .md appears in home list and opens in the editor", async ({ page }) => {
    const stamp = Date.now();
    const fileName = `e2e-home-${stamp}.md`;
    const searchPath = myDriveDocSearchPath(fileName);
    const apiPath = `/${searchPath}`;

    // Authenticate (storageState) and land on the Docs home view.
    await loginToDocs(page);

    // Seed a fresh Markdown file in My Drive; the upload indexes synchronously,
    // so browse mode should surface it on the next home fetch.
    await seedDocAtPath(apiPath, `# ${fileName}\n\nE2E docs home browse seed.\n`);

    // Re-fetch the home list now that the file is indexed.
    await gotoDocsHome(page);

    const row = docsHomeRow(page, fileName);
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Location column shows the personal drive's display name.
    await expect(row.locator(".drive-list-col-location")).toHaveText("Personal");

    // Double-clicking the row opens the file in the editor (a single click selects it).
    await row.dblclick();

    // Docs names the open file by its stable id (#1751), not its path.
    await expect(page).toHaveURL(/[?&]id=fn-[0-9a-f]{32}/, { timeout: 30_000 });
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".ProseMirror")).toContainText(fileName);

    // Sanity: the old path link to the same file still opens it, and is swapped for the id link.
    const idUrl = page.url();
    await page.goto(docsUrlForFile(apiPath));
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(idUrl, { timeout: 30_000 });
  });
});

// Docs home renders Drive's list and grid, which mount only the items near the
// viewport above 80 (#1641 step d). Its pages load 50 at a time as the end scrolls
// in. A grid tile previews images only, and Docs home lists no images, so the grid
// must read no document bytes however long the list is (chunk E).
const RUN = `dh${Date.now().toString(36)}`;
const FOLDER_API_PATH = `users/${E2E_USERNAME}/Windowed ${RUN}`;
const DOC_COUNT = 120;
const DOCS = Array.from(
  { length: DOC_COUNT },
  (_, index) => `Item ${String(index + 1).padStart(3, "0")}.md`,
);
const ITEM = "[data-list-item-id]";
const SELECTED = [`tr${ITEM}[aria-selected="true"]`, `.drive-file-tile--selected${ITEM}`].join(
  ", ",
);

/** View mode and Name sort, so the order is known whatever the files' upload times. */
function useViewSortedByName(page: Page, view: "list" | "grid") {
  return page.addInitScript((mode) => {
    localStorage.setItem("wgw.ui.docs.viewMode", mode);
    localStorage.setItem("wgw.docs.listSort", JSON.stringify({ key: "name", direction: "asc" }));
  }, view);
}

/** The selected item's name, whether it sits inside the scrollport, and whether it has focus. */
async function selectedItem(page: Page) {
  return page.evaluate(
    ({ item, selected }) => {
      const node = document.querySelector<HTMLElement>(selected);
      const scroller = document.querySelector(".docs-home-pane__scroll");
      if (!node || !scroller) return { name: null, inView: false, focused: false };
      const box = node.getBoundingClientRect();
      const port = scroller.getBoundingClientRect();
      return {
        name:
          node.querySelector(".drive-tile__hit")?.getAttribute("aria-label") ??
          node.querySelector(".drive-list-row__name .truncate")?.textContent?.trim() ??
          null,
        inView: box.top >= port.top - 1 && box.bottom <= port.bottom + 1,
        focused: document.activeElement?.closest(item) === node,
      };
    },
    { item: ITEM, selected: SELECTED },
  );
}

/** Scrolls to the end until every page has loaded (the load-more spinner is gone). */
async function loadEveryPage(page: Page) {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          const scroller = document.querySelector(".docs-home-pane__scroll");
          if (scroller) scroller.scrollTop = scroller.scrollHeight;
        });
        return page.locator(".drive-browser-load-more").count();
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(0);
}

test.describe("Docs home with more than 80 documents", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    await seedDriveFolder(FOLDER_API_PATH, DOCS);
    resetApiBudgetAfterSetup();
  });

  test.afterAll(async () => {
    await deleteDriveFile(`${FOLDER_API_PATH}/`);
  });

  for (const view of ["list", "grid"] as const) {
    test(`${view}: every page loads, arrow keys walk past the window, and no document bytes are read`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const byteReads: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/files/content")) byteReads.push(request.url());
      });
      await useViewSortedByName(page, view);
      await gotoDocsHome(page);
      // The folder name is in every seeded path, so this lists exactly those
      // documents, also on an account that holds a thousand more.
      await page.getByPlaceholder("Search documents...").fill(RUN);
      await expect(page.getByText(DOCS[0]!, { exact: true }).first()).toBeVisible({
        timeout: 60_000,
      });

      await loadEveryPage(page);
      const rows = page.locator("[data-workspace-list-rows]");
      // The list counts its rows; the grid counts rows of tiles under the Files heading.
      await expect(rows).toHaveAttribute(
        "data-workspace-list-rows",
        view === "list" ? String(DOC_COUNT) : /^\d+$/,
      );
      const mounted = await page.locator(ITEM).count();
      expect(mounted).toBeGreaterThan(3);
      expect(mounted).toBeLessThan(80);
      // The last document scrolled into view at the end of the list.
      await expect(page.getByText(DOCS[DOC_COUNT - 1]!, { exact: true }).first()).toBeVisible();

      // Back to the top, then ↓ sixty times from the first document: the selection
      // leaves the first window and stays in view, and focus follows it.
      await page.evaluate(() => {
        const scroller = document.querySelector(".docs-home-pane__scroll");
        if (scroller) scroller.scrollTop = 0;
      });
      const first =
        view === "grid"
          ? page.getByRole("button", { name: DOCS[0]!, exact: true })
          : page.getByText(DOCS[0]!, { exact: true }).first();
      await first.click();
      for (let step = 0; step < 60; step += 1) await page.keyboard.press("ArrowDown");
      await expect
        .poll(async () => selectedItem(page))
        .toEqual({ name: DOCS[60], inView: true, focused: true });

      expect(byteReads).toEqual([]);

      // Enter opens the selected document in the editor.
      await page.keyboard.press("Enter");
      await expect(page.locator(".ProseMirror")).toContainText(`seeded ${DOCS[60]}`, {
        timeout: 30_000,
      });
    });
  }
});
