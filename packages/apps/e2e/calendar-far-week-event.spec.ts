import { expect, test } from "@playwright/test";
import {
  clearCachedCalendarEvents,
  countEventCardsByTitle,
  createOfflineWeekEvent,
  deleteCalendarEventsByTitleViaApi,
  expectCalendarOnline,
  isoDateYearsFromToday,
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
