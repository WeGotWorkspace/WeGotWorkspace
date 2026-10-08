import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, CalendarEventsMap } from "@/lib/calendar-engine";
import {
  eventViewFromApiEvent,
  eventViewToApiEvent,
  fromEventsApiMap,
  resolvedDataEnd,
  toEventsApiMap,
  type CalendarEventView,
  type CalendarEventViewMap,
} from "./eventMapBridge.js";

const START = Temporal.PlainDateTime.from("2033-01-10T10:00:00");
const END = Temporal.PlainDateTime.from("2033-01-10T11:00:00");

/** Time span stays fixed: `CalendarEventData` is an end-or-duration union. */
function view(
  overrides: Partial<Omit<CalendarEventView, "start" | "end" | "duration">> = {},
): CalendarEventView {
  return {
    accountId: "acc",
    calendarId: "work",
    eventId: "ev-1",
    summary: "Standup",
    color: "#336699",
    ...overrides,
    start: START,
    end: END,
  };
}

describe("resolvedDataEnd", () => {
  it("keeps an explicit end", () => {
    expect(resolvedDataEnd({ start: START, end: END, summary: "x" })).toBe(END);
  });

  it("derives the end from a duration", () => {
    const end = resolvedDataEnd({
      start: START,
      duration: Temporal.Duration.from("PT45M"),
      summary: "x",
    });
    expect(end.toString()).toBe("2033-01-10T10:45:00");
  });
});

describe("eventViewToApiEvent", () => {
  it("splits the flat row into envelope fields and data", () => {
    const api = eventViewToApiEvent(view({ isRecurring: true, pendingOp: "updated" }));

    expect(api.eventId).toBe("ev-1");
    expect(api.calendarId).toBe("work");
    expect(api.isRecurring).toBe(true);
    expect(api.pendingOp).toBe("updated");
    expect(api.data.start).toBe(START);
    expect(api.data.summary).toBe("Standup");
  });

  it("omits an empty color so the calendar color wins", () => {
    expect(eventViewToApiEvent(view({ color: "" })).data).not.toHaveProperty("color");
    expect(eventViewToApiEvent(view({ color: undefined })).data).not.toHaveProperty("color");
    expect(eventViewToApiEvent(view()).data.color).toBe("#336699");
  });
});

describe("eventViewFromApiEvent", () => {
  it("flattens envelope and data back into one row", () => {
    const api: CalendarEvent = {
      accountId: "acc",
      calendarId: "work",
      eventId: "ev-1",
      isException: true,
      data: { start: START, duration: Temporal.Duration.from("PT30M"), summary: "Standup" },
    };

    const flat = eventViewFromApiEvent(api);
    expect(flat.eventId).toBe("ev-1");
    expect(flat.isException).toBe(true);
    expect(flat.summary).toBe("Standup");
    expect(flat.end?.toString()).toBe("2033-01-10T10:30:00");
  });
});

describe("map conversions", () => {
  it("round-trips a map of rows through the api shape", () => {
    const rows: CalendarEventViewMap = new Map([["ev-1", view()]]);
    const api: CalendarEventsMap = toEventsApiMap(rows);

    expect([...api.keys()]).toEqual(["ev-1"]);
    expect(api.get("ev-1")?.data.summary).toBe("Standup");

    const back = fromEventsApiMap(api);
    expect(back.get("ev-1")).toMatchObject({ eventId: "ev-1", summary: "Standup", end: END });
  });

  it("maps empty collections to empty collections", () => {
    expect(toEventsApiMap(new Map()).size).toBe(0);
    expect(fromEventsApiMap(new Map()).size).toBe(0);
  });
});
