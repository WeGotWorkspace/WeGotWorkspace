// Calendar with more than 500 events in the loaded window (live app, #2360).
//
// The bootstrap asks `CalendarEvent/query` with a back-referenced
// `CalendarEvent/get`. Above the announced `maxObjectsInGet` the get answered
// `requestTooLarge` and the calendar failed to load. The client now fetches
// the ids in chunks of the announced limit.
import { expect, test } from "./helpers/live-test";
import {
  clearCachedCalendarEvents,
  createUtcCalendarEventsViaApi,
  deleteCalendarEventsByTitleViaApi,
  openCalendarWeek,
} from "./helpers/calendar-live";

const RUN = Date.now().toString(36);
const TITLE = `e2e-many-${RUN}`;
const EVENT_COUNT = 520;

type JmapCall = [string, Record<string, unknown>, string];

function parseCalls(postData: string | null): JmapCall[] {
  try {
    return (JSON.parse(postData ?? "{}") as { methodCalls?: JmapCall[] }).methodCalls ?? [];
  } catch {
    return [];
  }
}

test.describe("Calendar with more than 500 events in the window (live app)", () => {
  test("loads every event through chunked gets", async ({ page }) => {
    test.setTimeout(240_000);
    try {
      // Hourly slots, a month ahead, so all of them sit in one loaded window.
      const base = Date.now() + 30 * 24 * 3600_000;
      const starts = Array.from({ length: EVENT_COUNT }, (_, index) =>
        new Date(base + index * 3600_000).toISOString().replace(/\.\d{3}Z$/, ""),
      );
      await createUtcCalendarEventsViaApi(TITLE, starts);

      await openCalendarWeek(page);
      await clearCachedCalendarEvents(page);

      const getSizes: (number | null)[] = [];
      page.on("request", (request) => {
        if (request.method() !== "POST" || !request.url().endsWith("/api/v1/jmap")) return;
        for (const [name, args] of parseCalls(request.postData())) {
          if (name === "CalendarEvent/get" && Array.isArray(args.ids)) {
            getSizes.push(args.ids.length);
          }
        }
      });

      await page.reload();
      await expect(page.locator(".calendar-workspace")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Failed to fetch")).toHaveCount(0);

      // Every seeded event reaches the offline cache.
      await expect
        .poll(
          () =>
            page.evaluate(async (title) => {
              const username = localStorage.getItem("wgw.offline.calendars.username");
              if (!username) return 0;
              return new Promise<number>((resolve) => {
                const request = indexedDB.open(`wgw-offline-${username.trim().toLowerCase()}`);
                request.onerror = () => resolve(0);
                request.onsuccess = () => {
                  const tx = request.result.transaction("calendars_events", "readonly");
                  const all = tx.objectStore("calendars_events").getAll();
                  all.onsuccess = () =>
                    resolve(
                      (all.result as { data: string }[]).filter(
                        (row) => (JSON.parse(row.data) as { title?: string }).title === title,
                      ).length,
                    );
                  all.onerror = () => resolve(0);
                };
              });
            }, TITLE),
          { timeout: 60_000 },
        )
        .toBe(EVENT_COUNT);

      // Chunks stayed within the announced limit (500).
      expect(getSizes.length).toBeGreaterThan(0);
      for (const size of getSizes) expect(size).toBeLessThanOrEqual(500);
    } finally {
      await deleteCalendarEventsByTitleViaApi(TITLE);
    }
  });
});
