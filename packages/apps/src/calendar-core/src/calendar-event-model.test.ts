import { describe, expect, it } from "vitest";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  occurrencesInRange,
  shiftAnchor,
  viewDateRange,
  rangeToPlainDateTimeStrings,
} from "@/calendar-core/src/calendar-event-model";

function wireEvent(overrides: Partial<JmapCalendarEvent> = {}): JmapCalendarEvent {
  return {
    "@type": "Event",
    id: "ev-1",
    uid: "uid-1",
    calendarIds: { work: true },
    title: "Standup",
    start: "2033-01-10T10:00:00",
    duration: "PT30M",
    timeZone: "Etc/UTC",
    ...overrides,
  } as JmapCalendarEvent;
}

describe("viewDateRange", () => {
  it("month covers full Monday-start weeks around the month", () => {
    // 2033-01-01 is a Saturday; grid starts Monday 2032-12-27.
    const range = viewDateRange("month", "2033-01-15");
    expect(range.start.toString()).toBe("2032-12-27");
    // 2033-02-01 is a Tuesday; grid runs through Sunday 2033-02-06 (end exclusive 02-07).
    expect(range.end.toString()).toBe("2033-02-07");
    const days = range.start.until(range.end, { largestUnit: "days" }).days;
    expect(days % 7).toBe(0);
  });

  it("week starts on Monday containing the anchor", () => {
    // 2033-01-12 is a Wednesday.
    const range = viewDateRange("week", "2033-01-12");
    expect(range.start.toString()).toBe("2033-01-10");
    expect(range.end.toString()).toBe("2033-01-17");
  });

  it("day is a single date", () => {
    const range = viewDateRange("day", "2033-01-12");
    expect(range.start.toString()).toBe("2033-01-12");
    expect(range.end.toString()).toBe("2033-01-13");
  });
});

describe("shiftAnchor", () => {
  it("month shift lands on the first of the adjacent month", () => {
    expect(shiftAnchor("month", "2033-01-31", 1)).toBe("2033-02-01");
    expect(shiftAnchor("month", "2033-01-15", -1)).toBe("2032-12-01");
  });

  it("week and day shift by their period", () => {
    expect(shiftAnchor("week", "2033-01-12", 1)).toBe("2033-01-19");
    expect(shiftAnchor("day", "2033-01-12", -1)).toBe("2033-01-11");
  });
});

describe("occurrencesInRange", () => {
  const range = rangeToPlainDateTimeStrings(viewDateRange("week", "2033-01-10"));

  it("maps wire events into sorted occurrences with calendar colors", () => {
    const occurrences = occurrencesInRange(
      [
        wireEvent({ id: "b", uid: "uid-b", title: "Later", start: "2033-01-10T12:00:00" }),
        wireEvent({ id: "a", uid: "uid-a", title: "Earlier", start: "2033-01-10T09:00:00" }),
      ],
      range,
      { calendars: [{ id: "work", name: "Work", color: "#ff0000" }] },
    );

    expect(occurrences.map((o) => o.title)).toEqual(["Earlier", "Later"]);
    expect(occurrences[0].color).toBe("#ff0000");
    expect(occurrences[0].eventId).toBe("a");
    expect(occurrences[0].end.toString()).toBe("2033-01-10T09:30:00");
  });

  it("expands recurring events into per-occurrence rows", () => {
    const occurrences = occurrencesInRange(
      [
        wireEvent({
          recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", count: 3 }],
        }),
      ],
      range,
    );

    expect(occurrences).toHaveLength(3);
    expect(new Set(occurrences.map((o) => o.eventId))).toEqual(new Set(["ev-1"]));
    expect(occurrences.every((o) => o.isRecurring)).toBe(true);
  });

  it("filters by visible calendars", () => {
    const occurrences = occurrencesInRange(
      [wireEvent(), wireEvent({ id: "ev-2", uid: "uid-2", calendarIds: { home: true } })],
      range,
      { visibleCalendarIds: new Set(["home"]) },
    );

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].calendarId).toBe("home");
  });
});
