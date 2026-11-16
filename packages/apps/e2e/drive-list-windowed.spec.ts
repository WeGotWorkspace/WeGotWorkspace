// The Drive list and grid mount only the items near the viewport once a folder holds
// more than 80 (#1641 step d). Arrow keys, scrolling to the end and the grid's
// sections must work as before.
import { expect, resetApiBudgetAfterSetup, test, type Page } from "./helpers/live-test";
import { E2E_USERNAME } from "./helpers/notes-live";
import { deleteDriveFile, seedDriveFolder } from "./helpers/drive-seed";

const RUN = Date.now().toString(36);
const FOLDER = `Windowed ${RUN}`;
const FOLDER_API_PATH = `users/${E2E_USERNAME}/${FOLDER}`;
const FOLDER_URL = `/drive?view=folder&path=${encodeURIComponent(`My Drive/${FOLDER}`)}`;
const FILE_COUNT = 120;
const FILES = Array.from(
  { length: FILE_COUNT },
  (_, index) => `Item ${String(index + 1).padStart(3, "0")}.txt`,
);
const ITEM = "[data-list-item-id]";
const SELECTED = [
  `tr${ITEM}[aria-selected="true"]`,
  `.drive-file-tile--selected${ITEM}`,
  `.drive-folder-tile--selected${ITEM}`,
].join(", ");

function useView(page: Page, view: "list" | "grid") {
  return page.addInitScript((mode) => localStorage.setItem("wgw.ui.drive.viewMode", mode), view);
}

/** The selected item's name, whether it sits inside the scrollport, and whether it has focus. */
async function selectedItem(page: Page) {
  return page.evaluate(
    ({ item, selected }) => {
      const node = document.querySelector<HTMLElement>(selected);
      let scroller = node?.parentElement ?? null;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
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

async function scrollToEnd(page: Page) {
  await page.evaluate((item) => {
    let scroller = document.querySelector(item)?.parentElement ?? null;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, ITEM);
}

test.describe("Drive folder with more than 80 items", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    await seedDriveFolder(FOLDER_API_PATH, FILES);
    resetApiBudgetAfterSetup();
  });

  test.afterAll(async () => {
    await deleteDriveFile(`${FOLDER_API_PATH}/`);
  });

  for (const view of ["list", "grid"] as const) {
    test(`${view}: arrow keys walk past the window, and the end of the folder scrolls in`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await useView(page, view);
      await page.goto(FOLDER_URL);
      await expect(page.locator(ITEM).first()).toBeVisible({ timeout: 60_000 });
      const rows = page.locator("[data-workspace-list-rows]");
      // The list counts its rows; the grid counts rows of tiles under one heading.
      await expect(rows).toHaveAttribute(
        "data-workspace-list-rows",
        view === "list" ? String(FILE_COUNT) : /^\d+$/,
        { timeout: 60_000 },
      );
      const mounted = await page.locator(ITEM).count();
      expect(mounted).toBeGreaterThan(3);
      expect(mounted).toBeLessThan(80);

      // ↓ sixty times from the first item: the selection leaves the first window and
      // stays in view, and focus follows it.
      // A tile's click target is its hit button, over the title.
      const first =
        view === "grid"
          ? page.getByRole("button", { name: FILES[0]!, exact: true })
          : page.getByText(FILES[0]!, { exact: true }).first();
      await first.click();
      for (let step = 0; step < 60; step += 1) await page.keyboard.press("ArrowDown");
      await expect
        .poll(async () => selectedItem(page))
        .toEqual({
          name: FILES[60],
          inView: true,
          focused: true,
        });

      // The last item scrolls into view at the end of the folder.
      await scrollToEnd(page);
      await expect(page.getByText(FILES[FILE_COUNT - 1]!, { exact: true }).first()).toBeVisible();
      if (view === "grid") {
        await expect(page.getByRole("region", { name: "Files" })).toBeVisible();
      }
    });
  }
});
