import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { UTC_TIMEZONE, type CalendarEvent } from "@/lib/calendar-engine";
import { mapTimelineOccurrenceEvents } from "./map-timeline-events.js";

const SCALE = {
  startDate: Temporal.PlainDate.from("2025-01-13"),
  numDays: 1,
  unitsPerDay: 24 * 60,
};

describe("mapTimelineOccurrenceEvents", () => {
  it("places a UTC timed event later on the Europe/Amsterdam day grid", () => {
    const event: CalendarEvent = {
      eventId: "standup@example.test",
      data: {
        start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
        end: Temporal.PlainDateTime.from("2025-01-13T09:30:00"),
        summary: "Standup",
        timeZone: UTC_TIMEZONE,
      },
    };
    const [utc] = mapTimelineOccurrenceEvents([["standup", event]], "timed", {
      now: Temporal.PlainDateTime.from("2025-01-13T12:00:00"),
      pending: null,
      scale: SCALE,
      displayTimeZone: "UTC",
      resolveColor: () => "#000",
    });
    const [amsterdam] = mapTimelineOccurrenceEvents([["standup", event]], "timed", {
      now: Temporal.PlainDateTime.from("2025-01-13T12:00:00"),
      pending: null,
      scale: SCALE,
      displayTimeZone: "Europe/Amsterdam",
      resolveColor: () => "#000",
    });
    expect(utc?.start).toBe(9 * 60);
    expect(amsterdam?.start).toBe(10 * 60);
    expect(amsterdam?.originalStart.toString()).toBe("2025-01-13T09:00:00");
  });
});
