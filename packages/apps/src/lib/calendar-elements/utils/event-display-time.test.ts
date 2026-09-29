import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import {
  dateTimesOverlapRange,
  displayOccurrenceInEventZone,
  eventOccurrenceInDisplayZone,
  padRangeForDisplayZone,
  wallClockInTimeZone,
} from "./event-display-time.js";

const utcNine = Temporal.PlainDateTime.from("2025-01-13T09:00:00");

describe("wallClockInTimeZone", () => {
  it("converts a UTC wall clock into Europe/Amsterdam in January", () => {
    expect(wallClockInTimeZone(utcNine, "UTC", "Europe/Amsterdam").toString()).toBe(
      "2025-01-13T10:00:00",
    );
  });

  it("keeps the wall clock when zones are missing or equal", () => {
    expect(wallClockInTimeZone(utcNine, undefined, "Europe/Amsterdam").toString()).toBe(
      utcNine.toString(),
    );
    expect(wallClockInTimeZone(utcNine, "UTC", "UTC").toString()).toBe(utcNine.toString());
  });
});

describe("eventOccurrenceInDisplayZone", () => {
  it("shifts timed zoned events and leaves all-day or floating put", () => {
    expect(
      eventOccurrenceInDisplayZone(utcNine, { timeZone: "Etc/UTC" }, "Europe/Amsterdam").toString(),
    ).toBe("2025-01-13T10:00:00");
    expect(
      eventOccurrenceInDisplayZone(
        utcNine,
        { allDay: true, timeZone: "UTC" },
        "Europe/Amsterdam",
      ).toString(),
    ).toBe(utcNine.toString());
    expect(eventOccurrenceInDisplayZone(utcNine, {}, "Europe/Amsterdam").toString()).toBe(
      utcNine.toString(),
    );
  });

  it("round-trips through the event zone", () => {
    const display = eventOccurrenceInDisplayZone(utcNine, { timeZone: "UTC" }, "America/New_York");
    expect(
      displayOccurrenceInEventZone(display, { timeZone: "UTC" }, "America/New_York").toString(),
    ).toBe(utcNine.toString());
  });
});

describe("padRangeForDisplayZone", () => {
  it("extends both edges by 14 hours", () => {
    const range = {
      start: Temporal.PlainDateTime.from("2025-01-13T00:00:00"),
      end: Temporal.PlainDateTime.from("2025-01-14T00:00:00"),
    };
    const padded = padRangeForDisplayZone(range);
    expect(padded.start.toString()).toBe("2025-01-12T10:00:00");
    expect(padded.end.toString()).toBe("2025-01-14T14:00:00");
  });
});

describe("dateTimesOverlapRange", () => {
  it("treats the range end as exclusive", () => {
    const start = Temporal.PlainDateTime.from("2025-01-13T00:00:00");
    const end = Temporal.PlainDateTime.from("2025-01-14T00:00:00");
    expect(
      dateTimesOverlapRange(
        Temporal.PlainDateTime.from("2025-01-13T23:00:00"),
        Temporal.PlainDateTime.from("2025-01-13T23:30:00"),
        start,
        end,
      ),
    ).toBe(true);
    expect(
      dateTimesOverlapRange(
        Temporal.PlainDateTime.from("2025-01-14T00:00:00"),
        Temporal.PlainDateTime.from("2025-01-14T01:00:00"),
        start,
        end,
      ),
    ).toBe(false);
  });
});
