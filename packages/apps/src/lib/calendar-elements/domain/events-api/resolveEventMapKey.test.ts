import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { EventsAPI, expandEvents, type CalendarEvent } from "@/lib/calendar-engine";
import { resolveEventMapKey, shouldAskSeriesScope } from "./resolveEventMapKey.js";

const RANGE = {
  start: Temporal.PlainDateTime.from("2033-01-10T00:00:00"),
  end: Temporal.PlainDateTime.from("2033-01-13T00:00:00"),
};

function dailyMaster(): CalendarEvent {
  return {
    eventId: "ev-1",
    calendarId: "work",
    isRecurring: true,
    data: {
      summary: "Daily",
      start: Temporal.PlainDateTime.from("2033-01-10T10:00:00"),
      duration: Temporal.Duration.from("PT30M"),
      recurrenceRule: { freq: "DAILY", interval: 1, count: 3 },
    },
  };
}

function startsOn(events: Iterable<CalendarEvent>): string[] {
  return [...events]
    .map((event) => event.data.start.toString())
    .sort((left, right) => left.localeCompare(right));
}

describe("resolveEventMapKey", () => {
  it("returns the master when only the series row exists (first this-instance drag)", () => {
    const events = new Map<string, CalendarEvent>([["ev-1", dailyMaster()]]);

    expect(
      resolveEventMapKey(events, {
        eventId: "ev-1",
        recurrenceId: "20330111T100000",
      }),
    ).toBe("ev-1");
  });

  it("returns the detached exception when eventId is the master persist id (#609)", () => {
    const master = dailyMaster();
    const events = new Map<string, CalendarEvent>([
      ["ev-1", master],
      [
        "ev-1::20330111T100000",
        {
          eventId: "ev-1",
          calendarId: "work",
          recurrenceId: "20330111T100000",
          isException: true,
          data: {
            summary: "Daily",
            start: Temporal.PlainDateTime.from("2033-01-11T11:00:00"),
            duration: Temporal.Duration.from("PT30M"),
          },
        },
      ],
    ]);

    expect(
      resolveEventMapKey(events, {
        eventId: "ev-1",
        recurrenceId: "20330111T100000",
      }),
    ).toBe("ev-1::20330111T100000");
  });

  it("returns the map key when the envelope already names the occurrence row", () => {
    const events = new Map<string, CalendarEvent>([
      ["ev-1", dailyMaster()],
      [
        "ev-1::20330111T100000",
        {
          eventId: "ev-1",
          recurrenceId: "20330111T100000",
          isException: true,
          data: {
            summary: "Daily",
            start: Temporal.PlainDateTime.from("2033-01-11T11:00:00"),
            duration: Temporal.Duration.from("PT30M"),
          },
        },
      ],
    ]);

    expect(
      resolveEventMapKey(events, {
        eventId: "ev-1::20330111T100000",
        recurrenceId: "20330111T100000",
      }),
    ).toBe("ev-1::20330111T100000");
  });

  it("does not ask series scope when the resolved key is already an exception", () => {
    const master = dailyMaster();
    const exception: CalendarEvent = {
      eventId: "ev-1",
      calendarId: "work",
      recurrenceId: "20330111T100000",
      isException: true,
      data: {
        summary: "Daily",
        start: Temporal.PlainDateTime.from("2033-01-11T11:00:00"),
        duration: Temporal.Duration.from("PT30M"),
      },
    };
    const events = new Map<string, CalendarEvent>([
      ["ev-1", master],
      ["ev-1::20330111T100000", exception],
    ]);

    expect(
      shouldAskSeriesScope({
        isRecurring: true,
        events,
        eventKey: "ev-1::20330111T100000",
      }),
    ).toBe(false);
    expect(
      shouldAskSeriesScope({
        isRecurring: true,
        events,
        eventKey: "ev-1",
      }),
    ).toBe(true);
  });
});

describe("moving an existing series exception (#609)", () => {
  it("keeps earlier occurrences put and does not resurrect the original slot", () => {
    const api = new EventsAPI(new Map([["ev-1", dailyMaster()]]));
    api.addException({
      target: { key: "ev-1" },
      recurrenceId: "20330111T100000",
      event: {
        start: Temporal.PlainDateTime.from("2033-01-11T11:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-11T11:30:00"),
        summary: "Daily",
        calendarId: "work",
      },
    });

    const afterDetach = expandEvents(api.events, RANGE);
    expect(startsOn(afterDetach.values())).toEqual([
      "2033-01-10T10:00:00",
      "2033-01-11T11:00:00",
      "2033-01-12T10:00:00",
    ]);

    const envelope = {
      eventId: "ev-1",
      recurrenceId: "20330111T100000",
    };
    const eventKey = resolveEventMapKey(api.events, envelope);
    api.move({
      target: { key: eventKey ?? "ev-1" },
      scope: "single",
      delta: Temporal.Duration.from("PT2H"),
    });

    const afterSecondMove = expandEvents(api.events, RANGE);
    expect(startsOn(afterSecondMove.values())).toEqual([
      "2033-01-10T10:00:00",
      "2033-01-11T13:00:00",
      "2033-01-12T10:00:00",
    ]);
    expect(api.events.get("ev-1")?.data.start.toString()).toBe("2033-01-10T10:00:00");
  });
});
