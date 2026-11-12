import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/live-test";
import {
  CALENDAR_WEEK_DATE,
  countCalendarEventsByTitleViaApi,
  createOfflineWeekEvent,
  deleteCalendarEventsByTitleViaApi,
  expectCalendarOffline,
  expectCalendarOnline,
  openCalendarWeek,
} from "./helpers/calendar-live";

/** The notice bar row for queued changes that fail to sync, under the Calendar header. */
function syncNotice(page: Page) {
  return page
    .getByRole("region", { name: "Calendar notices" })
    .locator(".notice-bar__notice")
    .filter({ hasText: "Some changes could not sync. They are saved on this device." });
}

test.describe("Calendar sync notice (live app)", () => {
  const createdTitles: string[] = [];
  test.afterEach(async () => {
    for (const title of createdTitles.splice(0)) {
      await deleteCalendarEventsByTitleViaApi(title);
    }
  });

  test("a refused calendar write shows Retry in every tab and clears once it lands", async ({
    page,
    context,
  }) => {
    test.setTimeout(150_000);
    const title = `e2e-sync-notice-${Date.now()}`;
    createdTitles.push(title);

    // Refuse the calendar write on the whole context, so a second tab cannot land it either.
    let held = true;
    await context.route("**/api/v1/jmap", (route) => {
      const body = route.request().postData() ?? "";
      if (held && body.includes("CalendarEvent/set")) {
        return route.fulfill({ status: 503, body: "held by the test" });
      }
      return route.continue();
    });

    await openCalendarWeek(page, CALENDAR_WEEK_DATE);
    await context.setOffline(true);
    await expectCalendarOffline(page);
    await createOfflineWeekEvent(page, title);

    // The reconnect flush hits the refused write and marks the queued row failed.
    await context.setOffline(false);
    await expectCalendarOnline(page);

    const poll = { timeout: 60_000 };
    const retry = (tab: Page) => syncNotice(tab).getByRole("button", { name: "Retry" });
    await expect(syncNotice(page), "the failed write shows the row").toBeVisible(poll);
    await expect(retry(page)).toBeEnabled();

    await retry(page).click();
    await expect(retry(page)).toBeEnabled(poll);
    await expect(syncNotice(page), "Retry while still refused keeps the row").toBeVisible();

    await page.reload();
    await expect(syncNotice(page), "the failed row survives a reload").toBeVisible(poll);

    const second = await context.newPage();
    try {
      await openCalendarWeek(second, CALENDAR_WEEK_DATE);
      await expect(syncNotice(second), "another tab reads the same outbox").toBeVisible(poll);
      expect(await countCalendarEventsByTitleViaApi(title), "nothing landed while held").toBe(0);

      held = false;
      await retry(page).click();
      await expect(syncNotice(page)).toHaveCount(0, poll);
      await expect(syncNotice(second)).toHaveCount(0, poll);
      await expect.poll(() => countCalendarEventsByTitleViaApi(title), { timeout: 30_000 }).toBe(1);
    } finally {
      await second.close();
    }
  });
});
