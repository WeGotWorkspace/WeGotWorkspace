// The Notes list mounts only the rows near the viewport once it has more than 80
// (#1641 step d). Keyboard navigation, scrolling and reload must work as before.
import { expect, resetApiBudgetAfterSetup, test, type Page } from "./helpers/live-test";
import { waitForNotesListReady } from "./helpers/notes-live";
import { createNotes, deleteNotes } from "./helpers/notes-rest";

const RUN = Date.now().toString(36);
const PREFIX = `Windowed ${RUN}`;
const NOTE_COUNT = 120;
const ROW = "[data-list-item-id]";

const list = (page: Page) => page.locator("[data-workspace-list-rows]");

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

async function focusedRowId(page: Page): Promise<string | null> {
  return page.evaluate(
    (rowSelector) =>
      document.activeElement?.closest(rowSelector)?.getAttribute("data-list-item-id") ?? null,
    ROW,
  );
}

test.describe("Notes list with more than 80 notes", () => {
  test("arrow keys walk past the window and keep focus", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/notes");
    await expect(page.getByRole("button", { name: "New note" })).toBeVisible({ timeout: 30_000 });
    const created: string[] = [];
    try {
      await createNotes(
        page,
        Array.from({ length: NOTE_COUNT }, (_, i) => `${PREFIX} ${String(i + 1).padStart(3, "0")}`),
        created,
      );
      resetApiBudgetAfterSetup();

      await page.reload();
      await waitForNotesListReady(page);
      await page.getByPlaceholder("Search notes...").fill(PREFIX);
      await expect(list(page)).toHaveAttribute("data-workspace-list-rows", String(NOTE_COUNT), {
        timeout: 60_000,
      });
      // Only a window of rows is in the DOM.
      const mounted = Number(await list(page).getAttribute("data-workspace-list-mounted"));
      expect(mounted).toBeGreaterThan(3);
      expect(mounted).toBeLessThan(40);
      expect(await page.locator(ROW).count()).toBe(mounted);

      // ↓ sixty times: the selection walks out of the first window and stays in view.
      const first = page.locator(ROW).first();
      await first.click();
      const firstId = await first.getAttribute("data-list-item-id");
      await first.focus();
      for (let step = 0; step < 60; step += 1) await page.keyboard.press("ArrowDown");
      await expect.poll(async () => (await selectedRow(page)).inView).toBe(true);
      const far = await selectedRow(page);
      expect(far.id).not.toBe(firstId);
      await expect(page).toHaveURL(new RegExp(`${far.id}$`));
      // Focus stays on a list row (the one it was on stays mounted), so keys keep working.
      expect(await focusedRowId(page)).toBe(firstId);

      // Shift+↓ grows the range across rows that mount as it goes.
      for (let step = 0; step < 5; step += 1) await page.keyboard.press("Shift+ArrowDown");
      await expect(page.locator(`${ROW}[data-selected="true"]`)).toHaveCount(6);

      // ↑ back to the top.
      for (let step = 0; step < 70; step += 1) await page.keyboard.press("ArrowUp");
      await expect.poll(async () => (await selectedRow(page)).id).toBe(firstId);
      expect((await selectedRow(page)).inView).toBe(true);

      // Scrolling to the end mounts the last rows, and the last one is in view.
      await page.evaluate((rowSelector) => {
        const scroller = document.querySelector(rowSelector)?.closest(".overflow-y-auto");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      }, ROW);
      await expect
        .poll(() =>
          page.evaluate((rowSelector) => {
            const rows = document.querySelectorAll(rowSelector);
            const last = rows[rows.length - 1];
            const scroller = last?.closest(".overflow-y-auto");
            if (!last || !scroller) return false;
            return (
              last.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom + 1
            );
          }, ROW),
        )
        .toBe(true);

      // Reload with a note far down open: it opens again, and the list works.
      await page.goto(`/notes/all/${far.id}`);
      await waitForNotesListReady(page);
      await expect(page).toHaveURL(new RegExp(`${far.id}$`));
      await page.getByPlaceholder("Search notes...").fill(PREFIX);
      await expect(list(page)).toHaveAttribute("data-workspace-list-rows", String(NOTE_COUNT));
      await page.locator(ROW).first().click();
      await page.keyboard.press("ArrowDown");
      await expect.poll(async () => (await selectedRow(page)).inView).toBe(true);
    } finally {
      await deleteNotes(page, created);
      resetApiBudgetAfterSetup();
    }
  });
});
