import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  calendarBootstrapWindow,
  isUtcRangeInside,
  rangeQueryCoversEvent,
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

describe("rangeQueryCoversEvent", () => {
  const week = range("2033-01-10", "2033-01-17");
  const month = range("2033-01-01", "2033-02-01");
  const utc = { timeZone: null } as Partial<JmapCalendarEvent>;
  const series = (start: string, rule: Record<string, unknown>, extra = {}) =>
    event(start, {
      recurrenceRules: [{ "@type": "RecurrenceRule", ...rule }],
      ...extra,
    } as Partial<JmapCalendarEvent>);

  it("covers a single event inside the range", () => {
    expect(rangeQueryCoversEvent(event("2033-01-12T10:00:00"), week)).toBe(true);
  });

  it("does not cover a single event outside the range", () => {
    expect(rangeQueryCoversEvent(event("2033-03-12T10:00:00"), week)).toBe(false);
    expect(rangeQueryCoversEvent(event("2032-11-12T10:00:00"), week)).toBe(false);
  });

  it("does not cover an event in the day at either edge (no padding outside the query)", () => {
    expect(rangeQueryCoversEvent(event("2033-01-09T22:00:00"), week)).toBe(false);
    expect(rangeQueryCoversEvent(event("2033-01-10T10:00:00"), week)).toBe(false);
    expect(rangeQueryCoversEvent(event("2033-01-16T23:00:00"), week)).toBe(false);
  });

  it("reads a UTC start with a Z, as CalDAV clients store it", () => {
    expect(rangeQueryCoversEvent(event("2033-01-12T10:00:00Z", utc), week)).toBe(true);
    expect(rangeQueryCoversEvent(event("2033-03-12T10:00:00Z", utc), week)).toBe(false);
  });

  it("reads a start with a numeric offset", () => {
    expect(rangeQueryCoversEvent(event("2033-01-12T10:00:00+02:00", utc), week)).toBe(true);
    expect(rangeQueryCoversEvent(event("2033-03-12T10:00:00-05:00", utc), week)).toBe(false);
  });

  it("reads an end with a Z", () => {
    // Starts before the range and runs into it: only the end puts it inside.
    const multiDay = event("2033-01-08T10:00:00Z", {
      timeZone: null,
      duration: undefined,
      end: "2033-01-12T11:00:00Z",
    } as Partial<JmapCalendarEvent>);
    expect(rangeQueryCoversEvent(multiDay, week)).toBe(true);
  });

  it("covers a series only when it has an occurrence in the range", () => {
    const weekly = series("2020-01-08T09:00:00", { frequency: "weekly" });
    const monthly = series("2020-01-28T09:00:00", { frequency: "monthly" });
    expect(rangeQueryCoversEvent(weekly, week)).toBe(true);
    expect(rangeQueryCoversEvent(monthly, week)).toBe(false);
    expect(rangeQueryCoversEvent(monthly, month)).toBe(true);
  });

  it("does not cover a series that ended before the range, by count or until", () => {
    const byCount = series("2020-01-08T09:00:00", { frequency: "weekly", count: 10 });
    const byUntil = series(
      "2020-01-08T09:00:00Z",
      { frequency: "weekly", until: "2021-01-01T00:00:00Z" },
      utc,
    );
    const runningUntil = series(
      "2020-01-08T09:00:00Z",
      { frequency: "weekly", until: "2040-01-01T00:00:00Z" },
      utc,
    );
    expect(rangeQueryCoversEvent(byCount, month)).toBe(false);
    expect(rangeQueryCoversEvent(byUntil, month)).toBe(false);
    expect(rangeQueryCoversEvent(runningUntil, month)).toBe(true);
  });

  it("does not cover an event whose start cannot be read", () => {
    expect(rangeQueryCoversEvent(event("not-a-date"), week)).toBe(false);
  });
});
