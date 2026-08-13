import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { viewDateRange, type CalendarOccurrence } from "@/calendar-core/src/calendar-event-model";
import { computeStaggerLayout } from "@/calendar-core/src/views/stagger-layout";
import {
  monthGridCells,
  staggerBlockMetrics,
  timeGridColumns,
} from "@/calendar-core/src/views/calendar-view-layout";

function occurrence(
  key: string,
  start: string,
  end: string,
  overrides: Partial<CalendarOccurrence> = {},
): CalendarOccurrence {
  return {
    key,
    eventId: key,
    calendarId: "default",
    title: key,
    color: "#6366f1",
    allDay: false,
    isRecurring: false,
    start: Temporal.PlainDateTime.from(start),
    end: Temporal.PlainDateTime.from(end),
    ...overrides,
  };
}

const today = Temporal.PlainDate.from("2033-01-12");

describe("computeStaggerLayout (reference port)", () => {
  it("splits same-start events into an even group with no indent", () => {
    const layouts = computeStaggerLayout([
      { start: 60, end: 120 },
      { start: 60, end: 180 },
    ]);
    expect(layouts[0]).toEqual({ groupIndex: 0, groupSize: 2, indent: 0 });
    expect(layouts[1]).toEqual({ groupIndex: 1, groupSize: 2, indent: 0 });
  });

  it("indents a later-starting overlapping event by the active depth", () => {
    const layouts = computeStaggerLayout([
      { start: 0, end: 120 },
      { start: 60, end: 180 },
      { start: 90, end: 200 },
    ]);
    expect(layouts[0].indent).toBe(0);
    expect(layouts[1].indent).toBe(1);
    expect(layouts[2].indent).toBe(2);
  });

  it("resets depth once earlier events have ended", () => {
    const layouts = computeStaggerLayout([
      { start: 0, end: 60 },
      { start: 60, end: 120 },
    ]);
    expect(layouts[1].indent).toBe(0);
  });
});

describe("monthGridCells", () => {
  const range = viewDateRange("month", "2033-01-12");

  it("produces full weeks with in-month and today flags", () => {
    const weeks = monthGridCells(range, "2033-01-12", [], today);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    const flat = weeks.flat();
    expect(flat[0].date.toString()).toBe("2032-12-27");
    expect(flat[0].inMonth).toBe(false);
    expect(flat.find((cell) => cell.isToday)?.date.toString()).toBe("2033-01-12");
  });

  it("places a multi-day event in every day it touches", () => {
    const weeks = monthGridCells(
      range,
      "2033-01-12",
      [occurrence("offsite", "2033-01-17T00:00:00", "2033-01-19T00:00:00", { allDay: true })],
      today,
    );
    const flat = weeks.flat();
    const daysWithEvent = flat
      .filter((cell) => cell.occurrences.length > 0)
      .map((cell) => cell.date.toString());
    expect(daysWithEvent).toEqual(["2033-01-17", "2033-01-18"]);
  });
});

describe("timeGridColumns", () => {
  const range = viewDateRange("day", "2033-01-12");

  it("positions timed blocks proportionally within the day", () => {
    const [column] = timeGridColumns(
      range,
      [occurrence("meeting", "2033-01-12T06:00:00", "2033-01-12T12:00:00")],
      today,
    );
    expect(column.isToday).toBe(true);
    expect(column.timed).toHaveLength(1);
    expect(column.timed[0].top).toBeCloseTo(25);
    expect(column.timed[0].height).toBeCloseTo(25);
  });

  it("routes all-day and day-spanning events to the all-day lane", () => {
    const [column] = timeGridColumns(
      range,
      [
        occurrence("allday", "2033-01-12T00:00:00", "2033-01-13T00:00:00", { allDay: true }),
        occurrence("spanning", "2033-01-11T20:00:00", "2033-01-13T04:00:00"),
        occurrence("timed", "2033-01-12T09:00:00", "2033-01-12T10:00:00"),
      ],
      today,
    );
    expect(column.allDay.map((o) => o.key).sort()).toEqual(["allday", "spanning"]);
    expect(column.timed.map((block) => block.occurrence.key)).toEqual(["timed"]);
  });

  it("enforces a minimum block height for short events", () => {
    const [column] = timeGridColumns(
      range,
      [occurrence("standup", "2033-01-12T09:00:00", "2033-01-12T09:05:00")],
      today,
    );
    expect(column.timed[0].height).toBeCloseTo((30 / (24 * 60)) * 100);
  });
});

describe("staggerBlockMetrics", () => {
  it("splits width for same-start groups", () => {
    expect(staggerBlockMetrics({ groupIndex: 1, groupSize: 2, indent: 0 })).toEqual({
      leftPercent: 50,
      widthPercent: 50,
      zIndex: 1,
    });
  });

  it("indents cascading events and raises z-order", () => {
    expect(staggerBlockMetrics({ groupIndex: 0, groupSize: 1, indent: 2 })).toEqual({
      leftPercent: 16,
      widthPercent: 84,
      zIndex: 3,
    });
  });
});
