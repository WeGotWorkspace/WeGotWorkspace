import { describe, expect, it, vi } from "vitest";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  applyCalendarColorsToEngineEvents,
  applyOwnRsvpToEngineEvents,
  calendarEventsToEngineMap,
  occurrencesInRange,
  shiftAnchor,
  viewDateRange,
  isViewShowingToday,
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

describe("isViewShowingToday", () => {
  it("is true when the rendered period matches today's period", () => {
    expect(isViewShowingToday("day", "2033-01-12", "2033-01-12")).toBe(true);
    expect(isViewShowingToday("week", "2033-01-14", "2033-01-12")).toBe(true);
    expect(isViewShowingToday("month", "2033-01-28", "2033-01-12")).toBe(true);
    expect(isViewShowingToday("year", "2033-06-01", "2033-01-12")).toBe(true);
  });

  it("is false when the rendered period is not today's", () => {
    expect(isViewShowingToday("day", "2033-01-11", "2033-01-12")).toBe(false);
    expect(isViewShowingToday("week", "2033-01-19", "2033-01-12")).toBe(false);
    expect(isViewShowingToday("month", "2033-02-01", "2033-01-12")).toBe(false);
    expect(isViewShowingToday("year", "2032-12-31", "2033-01-12")).toBe(false);
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

describe("applyCalendarColorsToEngineEvents", () => {
  it("joins CalendarInfo.color onto events that have no override", () => {
    const map = calendarEventsToEngineMap([wireEvent()]);
    expect(map.get("ev-1")?.data.color).toBeUndefined();

    const colored = applyCalendarColorsToEngineEvents(map, [
      { id: "work", name: "Work", color: "#0ea5e9" },
    ]);

    expect(colored.get("ev-1")?.data.color).toBe("#0ea5e9");
  });

  it("keeps an explicit event color over the calendar collection color", () => {
    const map = calendarEventsToEngineMap([wireEvent({ color: "#111111" })]);
    const colored = applyCalendarColorsToEngineEvents(map, [
      { id: "work", name: "Work", color: "#0ea5e9" },
    ]);

    expect(colored.get("ev-1")?.data.color).toBe("#111111");
  });

  it("calendarEventsToEngineMap joins colors when calendars are passed", () => {
    const map = calendarEventsToEngineMap([wireEvent()], {
      calendars: [{ id: "work", name: "Work", color: "#f59e0b" }],
    });

    expect(map.get("ev-1")?.data.color).toBe("#f59e0b");
  });
});

describe("calendarEventsToEngineMap", () => {
  it("maps Instant UTC start and skips a single unparseable neighbor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = calendarEventsToEngineMap([
      wireEvent({ id: "utc", uid: "uid-utc", start: "2033-01-10T10:00:00Z" }),
      wireEvent({ id: "bad", uid: "uid-bad", start: "not-a-datetime" }),
      wireEvent({ id: "ok", uid: "uid-ok", start: "2033-01-10T11:00:00" }),
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    expect(map.get("utc")?.data.start.toString()).toBe("2033-01-10T10:00:00");
    expect(map.get("ok")?.data.start.toString()).toBe("2033-01-10T11:00:00");
    expect(map.has("bad")).toBe(false);
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

  it("replaces the series instance when a this-instance override exists (#609)", () => {
    const occurrences = occurrencesInRange(
      [
        wireEvent({
          title: "Standup",
          recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", count: 3 }],
          recurrenceOverrides: {
            "2033-01-11T10:00:00": {
              title: "Standup (moved)",
              start: "2033-01-11T11:00:00",
            },
          },
        }),
      ],
      range,
    );

    const onOverrideDate = occurrences.filter((row) =>
      row.start.toString().startsWith("2033-01-11"),
    );
    expect(onOverrideDate).toHaveLength(1);
    expect(onOverrideDate[0]?.title).toBe("Standup (moved)");
    expect(onOverrideDate[0]?.start.toString()).toBe("2033-01-11T11:00:00");
    expect(occurrences.map((row) => row.title)).toEqual(["Standup", "Standup (moved)", "Standup"]);
  });

  it("replaces the series instance for a title-only this-instance override (#609)", () => {
    const occurrences = occurrencesInRange(
      [
        wireEvent({
          title: "Standup",
          recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", count: 3 }],
          recurrenceOverrides: {
            "2033-01-11T10:00:00": { title: "Standup (renamed)" },
          },
        }),
      ],
      range,
    );

    const onOverrideDate = occurrences.filter((row) =>
      row.start.toString().startsWith("2033-01-11"),
    );
    expect(onOverrideDate).toHaveLength(1);
    expect(onOverrideDate[0]?.title).toBe("Standup (renamed)");
    expect(onOverrideDate[0]?.start.toString()).toBe("2033-01-11T10:00:00");
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

  it("keeps unscoped events when a visibility set is present (week-view parity)", () => {
    const occurrences = occurrencesInRange(
      [wireEvent({ id: "ev-open", uid: "uid-open", calendarIds: {} })],
      range,
      { visibleCalendarIds: new Set(["default", "work"]) },
    );

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].title).toBe("Standup");
  });

  it("matches any enabled calendarIds key, not only the engine first key", () => {
    const occurrences = occurrencesInRange(
      [
        wireEvent({
          id: "ev-shared",
          uid: "uid-shared",
          calendarIds: { holidays: true, work: true },
        }),
      ],
      range,
      { visibleCalendarIds: new Set(["default", "work"]) },
    );

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].eventId).toBe("ev-shared");
  });

  it("hides every occurrence after a series decline, including stale needs-action exceptions", () => {
    const series = wireEvent({
      recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", count: 3 }],
      participants: {
        me: {
          "@type": "Participant",
          email: "me@example.test",
          roles: { attendee: true },
          participationStatus: "declined",
        },
      },
      recurrenceOverrides: {
        "2033-01-11T10:00:00": {
          title: "Moved standup",
          participants: {
            me: {
              "@type": "Participant",
              email: "me@example.test",
              roles: { attendee: true },
              participationStatus: "needs-action",
            },
          },
        },
      },
    });

    expect(occurrencesInRange([series], range, { sessionEmail: "me@example.test" })).toEqual([]);
  });

  it("keeps a later this-instance accept after a series decline", () => {
    const series = wireEvent({
      recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", count: 3 }],
      participants: {
        me: {
          "@type": "Participant",
          email: "me@example.test",
          roles: { attendee: true },
          participationStatus: "declined",
        },
      },
      recurrenceOverrides: {
        "2033-01-11T10:00:00": {
          participants: {
            me: {
              "@type": "Participant",
              email: "me@example.test",
              roles: { attendee: true },
              participationStatus: "accepted",
            },
          },
        },
      },
    });

    const visible = occurrencesInRange([series], range, { sessionEmail: "me@example.test" });
    expect(visible).toHaveLength(1);
    expect(visible[0].start.toString()).toBe("2033-01-11T10:00:00");
  });
});

describe("applyOwnRsvpToEngineEvents", () => {
  it("stamps needs-action and hides declined attendee events", () => {
    const waiting = wireEvent({
      id: "wait",
      uid: "uid-wait",
      participants: {
        me: {
          "@type": "Participant",
          email: "me@example.test",
          roles: { attendee: true },
          participationStatus: "needs-action",
        },
      },
    });
    const declined = wireEvent({
      id: "no",
      uid: "uid-no",
      title: "Skip",
      start: "2033-01-10T16:00:00",
      participants: {
        me: {
          "@type": "Participant",
          email: "me@example.test",
          roles: { attendee: true },
          participationStatus: "declined",
        },
      },
    });
    const map = applyOwnRsvpToEngineEvents(
      calendarEventsToEngineMap([waiting, declined]),
      [waiting, declined],
      "me@example.test",
    );

    expect([...map.keys()]).toEqual(["wait"]);
    expect(map.get("wait")?.participationStatus).toBe("needs-action");
  });

  it("hides one declined occurrence and keeps the accepted series", () => {
    const series = wireEvent({
      recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", count: 3 }],
      participants: {
        me: {
          "@type": "Participant",
          email: "me@example.test",
          roles: { attendee: true },
          participationStatus: "accepted",
        },
      },
      recurrenceOverrides: {
        "2033-01-11T10:00:00": {
          participants: {
            me: {
              "@type": "Participant",
              email: "me@example.test",
              roles: { attendee: true },
              participationStatus: "declined",
            },
          },
        },
      },
    });
    const map = applyOwnRsvpToEngineEvents(
      calendarEventsToEngineMap([series]),
      [series],
      "me@example.test",
    );

    expect(map.get("ev-1")?.participationStatus).toBe("accepted");
    const declined = [...map.entries()].find(
      ([, event]) => event.participationStatus === "declined",
    );
    expect(declined?.[1].participationStatus).toBe("declined");
    expect(map.has("ev-1")).toBe(true);
  });
});
