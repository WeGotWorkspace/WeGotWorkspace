import { expect, test } from "./helpers/live-test";
import {
  clearCachedCalendarEvents,
  countEventCardsByTitle,
  createOfflineWeekEvent,
  createUtcCalendarEventViaApi,
  deleteCalendarEventsByTitleViaApi,
  expectCalendarOffline,
  expectCalendarOnline,
  isoDateYearsFromToday,
  navigateCalendarInApp,
  openCalendarWeek,
} from "./helpers/calendar-live";

/**
 * #1675: the calendar loads a window of 12 months back to 24 months ahead.
 * A week outside it must load on demand, and an event created there must stay.
 */
const FAR_WEEKS = [
  { label: "about 9 years ahead", date: isoDateYearsFromToday(9), slug: "ahead" },
  { label: "about 2 years back", date: isoDateYearsFromToday(-2), slug: "back" },
];

test.describe("Calendar weeks outside the loaded window (live app)", () => {
  for (const week of FAR_WEEKS) {
    test(`an event created in a week ${week.label} stays and reloads`, async ({ page }) => {
      test.setTimeout(120_000);
      const title = `e2e-far-${week.slug}-${Date.now()}`;
      try {
        await openCalendarWeek(page, week.date);
        await expectCalendarOnline(page);

        await createOfflineWeekEvent(page, title);
        await expect
          .poll(() => countEventCardsByTitle(page, title), { timeout: 15_000 })
          .toBeGreaterThan(0);

        // Past the refresh that follows a create: the card must still be there.
        await page.waitForTimeout(4_000);
        expect(
          await countEventCardsByTitle(page, title),
          "new event left the week after the refresh",
        ).toBeGreaterThan(0);

        await page.reload();
        await openCalendarWeek(page, week.date);
        await expect
          .poll(() => countEventCardsByTitle(page, title), { timeout: 20_000 })
          .toBeGreaterThan(0);

        // Without the cached copy the week has to load from the API.
        await clearCachedCalendarEvents(page);
        await page.reload();
        await openCalendarWeek(page, week.date);
        await expect
          .poll(() => countEventCardsByTitle(page, title), { timeout: 20_000 })
          .toBeGreaterThan(0);
      } finally {
        await deleteCalendarEventsByTitleViaApi(title);
      }
    });
  }
});

test.describe("Calendar UTC event outside the loaded window (live app)", () => {
  // Chromium's offline emulation does not reach service-worker fetches: against
  // a production build the app would still load the week through the worker.
  test.use({ serviceWorkers: "block" });

  test("a UTC event from another client stays cached for offline", async ({ page }) => {
    test.setTimeout(120_000);
    const title = `e2e-far-utc-${Date.now()}`;
    const date = isoDateYearsFromToday(9);
    await createUtcCalendarEventViaApi(title, `${date}T10:00:00`);
    try {
      await openCalendarWeek(page, date);
      await expectCalendarOnline(page);
      await expect
        .poll(() => countEventCardsByTitle(page, title), { timeout: 20_000 })
        .toBeGreaterThan(0);

      // Load the current week twice: the first live bootstrap rewrites the
      // cache, the second paints only from what that rewrite kept.
      for (let load = 0; load < 2; load += 1) {
        await openCalendarWeek(page, isoDateYearsFromToday(0));
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1_000);
      }

      await page.context().setOffline(true);
      await expectCalendarOffline(page);
      await navigateCalendarInApp(page, `/calendar/week/${date}`);
      await expect
        .poll(() => countEventCardsByTitle(page, title), { timeout: 15_000 })
        .toBeGreaterThan(0);
    } finally {
      await page.context().setOffline(false);
      await deleteCalendarEventsByTitleViaApi(title);
    }
  });
});
