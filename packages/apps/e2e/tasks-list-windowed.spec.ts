// The Tasks list mounts only the rows near the viewport once it has more than 80
// (#1641 step d). Keyboard navigation, ticking a task far down and scrolling must
// work as before.
import { expect, resetApiBudgetAfterSetup, test, type Page } from "./helpers/live-test";
import { createList, createTask, deleteList, waitForTasks } from "./helpers/tasks-matrix";
import type { Tab } from "./helpers/live-matrix";

const RUN = Date.now().toString(36);
const LIST = `Windowed ${RUN}`;
const TASK_COUNT = 120;
const ROW = "[data-list-item-id]";

const list = (page: Page) => page.locator(".tasks-list-panel__list[data-workspace-list-rows]");

/** The selected row's id and whether it sits fully inside the list's scrollport. */
async function selectedRow(page: Page) {
  return page.evaluate((rowSelector) => {
    const row = document.querySelector<HTMLElement>(`${rowSelector}[data-selected="true"]`);
    const scroller = row?.closest<HTMLElement>(".overflow-y-auto");
    if (!row || !scroller) return { id: null, inView: false };
    const box = row.getBoundingClientRect();
    const port = scroller.getBoundingClientRect();
    return {
      id: row.getAttribute("data-list-item-id"),
      inView: box.top >= port.top - 1 && box.bottom <= port.bottom + 1,
    };
  }, ROW);
}

async function scrollListTo(page: Page, fraction: number) {
  await page.evaluate(
    ([rowSelector, at]) => {
      const scroller = document.querySelector(rowSelector)?.closest(".overflow-y-auto");
      if (scroller) scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * at;
    },
    [ROW, fraction] as const,
  );
}

test.describe("Tasks list with more than 80 tasks", () => {
  test("arrow keys walk past the window, and a far task ticks off", async ({ page }) => {
    test.setTimeout(180_000);
    const listId = await createList(LIST);
    try {
      for (let at = 0; at < TASK_COUNT; at += 8) {
        await Promise.all(
          Array.from({ length: Math.min(8, TASK_COUNT - at) }, (_, i) => {
            const n = at + i + 1;
            return createTask(
              listId,
              `${LIST} ${String(n).padStart(3, "0")}`,
              n % 3 === 0 ? { description: `Notes for task ${n}` } : {},
            );
          }),
        );
      }
      resetApiBudgetAfterSetup();

      await page.goto(`/tasks/lists/${encodeURIComponent(listId)}`);
      await waitForTasks(page as Tab);
      await expect(list(page)).toHaveAttribute("data-workspace-list-rows", String(TASK_COUNT), {
        timeout: 60_000,
      });
      // Only a window of rows is in the DOM.
      const mounted = Number(await list(page).getAttribute("data-workspace-list-mounted"));
      expect(mounted).toBeGreaterThan(3);
      expect(mounted).toBeLessThan(40);
      expect(await page.locator(`.tasks-list-panel__list ${ROW}`).count()).toBe(mounted);

      // ↓ sixty times: the selection walks out of the first window and stays in view.
      const first = page.locator(ROW).first();
      await first.click({ position: { x: 160, y: 12 } });
      const firstId = await first.getAttribute("data-list-item-id");
      for (let step = 0; step < 60; step += 1) await page.keyboard.press("ArrowDown");
      await expect.poll(async () => (await selectedRow(page)).inView).toBe(true);
      const far = await selectedRow(page);
      expect(far.id).not.toBe(firstId);
      // Each step opens that task.
      const farTitle = await page
        .locator(`${ROW}[data-list-item-id="${far.id}"] .list-item__title`)
        .textContent();
      await expect(page.getByPlaceholder("Task name")).toHaveValue(farTitle ?? "");

      // Tick a task in the middle of the list: it plays its exit and leaves the list.
      // Pick it by id once the window has settled: rows mount and unmount on scroll.
      await scrollListTo(page, 0.5);
      await page.waitForTimeout(500);
      const tickedId = await page
        .locator(`.tasks-list-panel__list ${ROW}`)
        .nth(4)
        .getAttribute("data-list-item-id");
      await page
        .locator(".tasks-list-row", {
          has: page.locator(`${ROW}[data-list-item-id="${tickedId}"]`),
        })
        .getByRole("checkbox")
        .click();
      await expect(page.locator(`${ROW}[data-list-item-id="${tickedId}"]`)).toHaveCount(0);
      await expect(list(page)).toHaveAttribute("data-workspace-list-rows", String(TASK_COUNT - 1));

      // Scrolling to the end mounts the last rows, and the last one is in view.
      await scrollListTo(page, 1);
      await expect
        .poll(() =>
          page.evaluate((rowSelector) => {
            const rows = document.querySelectorAll(`.tasks-list-panel__list ${rowSelector}`);
            const last = rows[rows.length - 1];
            const scroller = last?.closest(".overflow-y-auto");
            if (!last || !scroller) return null;
            const inView =
              last.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom + 1;
            return inView;
          }, ROW),
        )
        .toBe(true);
    } finally {
      await deleteList(listId);
      resetApiBudgetAfterSetup();
    }
  });
});
