import { describe, expect, it } from "vitest";
import { MOCK_CALENDAR_ANCHOR } from "@/lib/api/mock/calendar-bootstrap";
import {
  createDevCalendarSeedEvents,
  createSeededCalendarAppBootstrap,
  DEV_CALENDAR_SEED_FULL_TARGET,
} from "@/lib/api/mock/calendar-seed";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";

describe("createDevCalendarSeedEvents", () => {
  it("matches the API full-profile catalog size and calendars", () => {
    const events = createDevCalendarSeedEvents();
    expect(events.length).toBe(DEV_CALENDAR_SEED_FULL_TARGET);
    const calendarIds = new Set(events.flatMap((event) => Object.keys(event.calendarIds)));
    expect(calendarIds).toEqual(new Set(["default", "home", "work"]));
    expect(new Set(events.map((event) => event.uid)).size).toBe(events.length);
  });

  it("maps into the calendar engine for the January 2033 month story", () => {
    const seeded = createSeededCalendarAppBootstrap();
    const map = calendarEventsToEngineMap(seeded.data.events, {
      sessionEmail: seeded.session.user.email,
      calendars: seeded.data.calendars,
    });
    expect(map.size).toBeGreaterThan(DEV_CALENDAR_SEED_FULL_TARGET);
    expect(seeded.data.calendars.some((calendar) => calendar.id === "home")).toBe(true);
    expect(MOCK_CALENDAR_ANCHOR).toBe("2033-01-12");
  });
});
