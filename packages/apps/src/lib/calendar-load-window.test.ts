import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  calendarBootstrapWindow,
  calendarEventMayOverlapRange,
  isUtcRangeInside,
} from "@/lib/calendar-load-window";

const today = Temporal.PlainDate.from("2026-10-27");

function event(start: string, extra: Partial<JmapCalendarEvent> = {}): JmapCalendarEvent {
  return {
    "@type": "Event",
    id: "ev",
    uid: "urn:uuid:ev",
    calendarIds: { default: true },
    start,
    duration: "PT1H",
    timeZone: "Europe/Amsterdam",
    ...extra,
  } as JmapCalendarEvent;
}

const range = (start: string, end: string) => ({
  utcStart: new Date(`${start}T00:00:00Z`),
  utcEnd: new Date(`${end}T00:00:00Z`),
});

describe("calendarBootstrapWindow", () => {
  it("spans 12 months back to 24 months ahead of today", () => {
    expect(calendarBootstrapWindow(today)).toEqual(range("2025-10-01", "2028-10-01"));
  });
});

describe("isUtcRangeInside", () => {
  const window = calendarBootstrapWindow(today);

  it("is true for a range inside the bootstrap window", () => {
    expect(isUtcRangeInside(range("2027-06-01", "2027-06-22"), window)).toBe(true);
  });

  it("is false for a range past the window end (the #1675 boundary)", () => {
    expect(isUtcRangeInside(range("2028-10-02", "2028-10-23"), window)).toBe(false);
    expect(isUtcRangeInside(range("2028-09-25", "2028-10-09"), window)).toBe(false);
  });

  it("is false for a range more than a year back", () => {
    expect(isUtcRangeInside(range("2024-10-14", "2024-11-04"), window)).toBe(false);
  });
});

describe("calendarEventMayOverlapRange", () => {
  const week = range("2033-01-10", "2033-01-17");

  it("matches a single event inside the range", () => {
    expect(calendarEventMayOverlapRange(event("2033-01-12T10:00:00"), week)).toBe(true);
  });

  it("does not match a single event weeks away", () => {
    expect(calendarEventMayOverlapRange(event("2033-03-12T10:00:00"), week)).toBe(false);
    expect(calendarEventMayOverlapRange(event("2032-11-12T10:00:00"), week)).toBe(false);
  });

  it("matches an open-ended series that started before the range", () => {
    const series = event("2020-01-06T09:00:00", {
      recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "weekly" }],
    } as Partial<JmapCalendarEvent>);
    expect(calendarEventMayOverlapRange(series, week)).toBe(true);
  });

  it("does not match a series whose last occurrence is before the range", () => {
    const series = event("2020-01-06T09:00:00", {
      recurrenceRules: [
        { "@type": "RecurrenceRule", frequency: "weekly", until: "2021-01-01T00:00:00" },
      ],
    } as Partial<JmapCalendarEvent>);
    expect(calendarEventMayOverlapRange(series, week)).toBe(false);
  });

  it("reads a UTC start with a Z, as CalDAV clients store it", () => {
    const utc = { timeZone: null } as Partial<JmapCalendarEvent>;
    expect(calendarEventMayOverlapRange(event("2033-01-12T10:00:00Z", utc), week)).toBe(true);
    expect(calendarEventMayOverlapRange(event("2033-03-12T10:00:00Z", utc), week)).toBe(false);
    expect(calendarEventMayOverlapRange(event("2032-11-12T10:00:00Z", utc), week)).toBe(false);
  });

  it("reads a start with a numeric offset", () => {
    const offset = { timeZone: null } as Partial<JmapCalendarEvent>;
    expect(calendarEventMayOverlapRange(event("2033-01-12T10:00:00+02:00", offset), week)).toBe(
      true,
    );
    expect(calendarEventMayOverlapRange(event("2033-03-12T10:00:00-05:00", offset), week)).toBe(
      false,
    );
  });

  it("reads an end with a Z", () => {
    const utcEnd = {
      timeZone: null,
      duration: undefined,
      end: "2033-03-12T11:00:00Z",
    } as Partial<JmapCalendarEvent>;
    expect(calendarEventMayOverlapRange(event("2033-03-12T10:00:00Z", utcEnd), week)).toBe(false);
  });

  it("reads a series until with a Z", () => {
    const ended = event("2020-01-06T09:00:00Z", {
      timeZone: null,
      recurrenceRules: [
        { "@type": "RecurrenceRule", frequency: "weekly", until: "2021-01-01T00:00:00Z" },
      ],
    } as Partial<JmapCalendarEvent>);
    const running = event("2020-01-06T09:00:00Z", {
      timeZone: null,
      recurrenceRules: [
        { "@type": "RecurrenceRule", frequency: "weekly", until: "2040-01-01T00:00:00Z" },
      ],
    } as Partial<JmapCalendarEvent>);
    expect(calendarEventMayOverlapRange(ended, week)).toBe(false);
    expect(calendarEventMayOverlapRange(running, week)).toBe(true);
  });

  it("errs towards a match when the start cannot be read", () => {
    expect(calendarEventMayOverlapRange(event("not-a-date"), week)).toBe(true);
  });
});
