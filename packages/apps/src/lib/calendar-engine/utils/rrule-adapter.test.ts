import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { RRuleSet } from "rrule";
import { expandRecurringStarts } from "./rrule-adapter.js";
import { UTC_TIMEZONE } from "../types/event/timezone.js";
import { createDailySeriesState } from "../tests/support/mockEvents.js";

describe("expandRecurringStarts memo", () => {
  it("reuses RRule.between for the same event object and range", () => {
    const betweenSpy = vi.spyOn(RRuleSet.prototype, "between");
    const event = createDailySeriesState().get("daily")!;
    const rangeStart = Temporal.PlainDateTime.from("2025-01-13T00:00:00");
    const rangeEnd = Temporal.PlainDateTime.from("2025-01-20T00:00:00");

    const first = expandRecurringStarts(event, rangeStart, rangeEnd, { timezone: "UTC" });
    const second = expandRecurringStarts(event, rangeStart, rangeEnd, { timezone: "UTC" });

    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(0);
    expect(betweenSpy).toHaveBeenCalledTimes(1);
    betweenSpy.mockRestore();
  });

  it("recomputes when the requested range changes", () => {
    const betweenSpy = vi.spyOn(RRuleSet.prototype, "between");
    const event = createDailySeriesState().get("daily")!;
    expandRecurringStarts(
      event,
      Temporal.PlainDateTime.from("2025-01-13T00:00:00"),
      Temporal.PlainDateTime.from("2025-01-16T00:00:00"),
      { timezone: "UTC" },
    );
    expandRecurringStarts(
      event,
      Temporal.PlainDateTime.from("2025-01-16T00:00:00"),
      Temporal.PlainDateTime.from("2025-01-20T00:00:00"),
      { timezone: "UTC" },
    );
    expect(betweenSpy).toHaveBeenCalledTimes(2);
    betweenSpy.mockRestore();
  });

  it("keeps the same local wall clocks when options.timezone changes", () => {
    const event = createDailySeriesState().get("daily")!;
    const rangeStart = Temporal.PlainDateTime.from("2025-01-13T00:00:00");
    const rangeEnd = Temporal.PlainDateTime.from("2025-01-20T00:00:00");

    const utc = expandRecurringStarts(event, rangeStart, rangeEnd, { timezone: "UTC" });
    const amsterdam = expandRecurringStarts(event, rangeStart, rangeEnd, {
      timezone: "Europe/Amsterdam",
    });

    expect(amsterdam.map((start) => start.toString())).toEqual(
      utc.map((start) => start.toString()),
    );
    expect(utc[0]?.toString()).toBe("2025-01-13T09:00:00");
  });
});

describe("expandRecurringStarts wall clocks", () => {
  it("keeps JSCalendar local wall clocks when the event has a timeZone (#609)", () => {
    const event = createDailySeriesState().get("daily")!;
    event.data.timeZone = UTC_TIMEZONE;
    event.data.recurrenceRule = { freq: "DAILY", interval: 1, count: 3 };

    const starts = expandRecurringStarts(
      event,
      Temporal.PlainDateTime.from("2025-01-13T00:00:00"),
      Temporal.PlainDateTime.from("2025-01-20T00:00:00"),
      { timezone: "Europe/Amsterdam" },
    );

    expect(starts.map((start) => start.toString())).toEqual([
      "2025-01-13T09:00:00",
      "2025-01-14T09:00:00",
      "2025-01-15T09:00:00",
    ]);
  });
});
