// Undo while offline (#1854).
//
// Offline, Undo works on the outbox: a queued Notes archive is turned around in place, and a
// queued Calendar create is dropped. After reconnecting, the flush must leave the server on
// the reverted state, with no sync conflict reported.
import { expect, test } from "./helpers/live-test";
import {
  CALENDAR_WEEK_DATE,
  countCalendarEventsByTitleViaApi,
  countEventCardsByTitle,
  createOfflineWeekEvent,
  deleteCalendarEventsByTitleViaApi,
  expectCalendarOffline,
  expectCalendarOnline,
  openCalendarWeek,
} from "./helpers/calendar-live";
import {
  api,
  listTitles,
  openNotesTab,
  openUser,
  OWNER,
  PRIVATE_NOTEBOOK,
  serverNote,
  setTabOffline,
  sleep,
} from "./helpers/notes-matrix";

test.describe("Undo while offline", () => {
  test.describe("Notes archive", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("Undo of a queued archive leaves the note unarchived on the server", async ({
      browser,
    }) => {
      test.setTimeout(150_000);
      const uid = crypto.randomUUID();
      const title = `Undo offline ${uid.slice(0, 8)}`;
      const res = await api(OWNER, "POST", "/notes/items", {
        uid,
        notebookId: PRIVATE_NOTEBOOK,
        title,
        body: "undo offline",
      });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      const events: string[] = [];
      const context = await openUser(browser, OWNER);
      try {
        const a = await openNotesTab(context, OWNER, "A", events);
        const listed = async () => (await listTitles(a)).some((row) => row.startsWith(title));
        const showView = async (name: string) => {
          await a.getByRole("button", { name, exact: true }).first().click();
          await sleep(500);
        };
        await showView("All Items");
        await expect.poll(listed, { timeout: 30_000 }).toBe(true);
        await a.locator(".list-item__button", { hasText: title }).first().click();
        await a.locator(".note-detail-view__title").waitFor({ timeout: 15_000 });
        await sleep(1_000);

        await setTabOffline(a, true);
        await a.getByRole("button", { name: "Archive", exact: true }).click();
        await a
          .locator("[data-sonner-toast]")
          .getByRole("button", { name: "Undo" })
          .last()
          .click({ timeout: 5_000 });
        await expect(a.getByText(/undone\./).first()).toBeVisible({ timeout: 5_000 });

        await setTabOffline(a, false);
        // Let the flush run, then check the server stayed unarchived.
        await sleep(5_000);
        await expect
          .poll(async () => (await serverNote(OWNER, uid))?.archived, { timeout: 30_000 })
          .toBe(false);

        await a.reload();
        await a.getByRole("button", { name: "New note" }).waitFor({ timeout: 60_000 });
        await showView("All Items");
        await expect.poll(listed, { timeout: 30_000 }).toBe(true);
        await showView("Archived");
        expect((await listTitles(a)).some((row) => row.startsWith(title))).toBe(false);
        expect((await serverNote(OWNER, uid))?.archived).toBe(false);
        expect(events).toEqual([]);
      } finally {
        await context.close().catch(() => undefined);
        await api(OWNER, "DELETE", `/notes/items/${uid}`);
      }
    });
  });

  test("Calendar: Undo of a queued create never reaches the server", async ({ page }) => {
    test.setTimeout(120_000);
    const title = `e2e-undo-off-${Date.now()}`;
    try {
      await openCalendarWeek(page, CALENDAR_WEEK_DATE);
      await page.context().setOffline(true);
      await expectCalendarOffline(page);

      await createOfflineWeekEvent(page, title);
      await expect
        .poll(() => countEventCardsByTitle(page, title), { timeout: 15_000 })
        .toBeGreaterThan(0);
      await page
        .locator("[data-sonner-toast]")
        .getByRole("button", { name: "Undo" })
        .last()
        .click({ timeout: 5_000 });
      await expect.poll(() => countEventCardsByTitle(page, title), { timeout: 10_000 }).toBe(0);

      await page.context().setOffline(false);
      await expectCalendarOnline(page);
      await page.waitForTimeout(5_000);
      expect(await countCalendarEventsByTitleViaApi(title)).toBe(0);

      await page.reload();
      await expectCalendarOnline(page);
      await page.waitForTimeout(2_000);
      expect(await countEventCardsByTitle(page, title)).toBe(0);
      expect(await countCalendarEventsByTitleViaApi(title)).toBe(0);
    } finally {
      await page
        .context()
        .setOffline(false)
        .catch(() => undefined);
      await deleteCalendarEventsByTitleViaApi(title);
    }
  });
});
