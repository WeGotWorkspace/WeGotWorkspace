import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { startOfWeekFor, weekNumberForDate } from "./WeekNumber.js";

describe("startOfWeekFor", () => {
  it("aligns to the Monday on or before the date for weekStart 1", () => {
    // 2025-01-08 is a Wednesday.
    expect(startOfWeekFor(Temporal.PlainDate.from("2025-01-08"), 1).toString()).toBe("2025-01-06");
    // A Monday stays put.
    expect(startOfWeekFor(Temporal.PlainDate.from("2025-01-06"), 1).toString()).toBe("2025-01-06");
  });

  it("aligns to the Sunday on or before the date for weekStart 7", () => {
    expect(startOfWeekFor(Temporal.PlainDate.from("2025-01-08"), 7).toString()).toBe("2025-01-05");
    expect(startOfWeekFor(Temporal.PlainDate.from("2025-01-05"), 7).toString()).toBe("2025-01-05");
  });
});

describe("weekNumberForDate", () => {
  it("puts January 1st in week 1", () => {
    expect(weekNumberForDate(Temporal.PlainDate.from("2025-01-01"), 1)).toBe(1);
    expect(weekNumberForDate(Temporal.PlainDate.from("2025-01-01"), 7)).toBe(1);
  });

  it("counts weeks from the week containing January 1st (Monday start)", () => {
    // 2025-01-01 is a Wednesday; its Monday-aligned week runs Dec 30 – Jan 5.
    expect(weekNumberForDate(Temporal.PlainDate.from("2025-01-05"), 1)).toBe(1);
    expect(weekNumberForDate(Temporal.PlainDate.from("2025-01-06"), 1)).toBe(2);
    expect(weekNumberForDate(Temporal.PlainDate.from("2025-01-12"), 1)).toBe(2);
    expect(weekNumberForDate(Temporal.PlainDate.from("2025-12-31"), 1)).toBe(53);
  });

  it("shifts week boundaries with the week start", () => {
    // Sunday start: the week containing 2025-01-01 runs Dec 29 – Jan 4.
    expect(weekNumberForDate(Temporal.PlainDate.from("2025-01-04"), 7)).toBe(1);
    expect(weekNumberForDate(Temporal.PlainDate.from("2025-01-05"), 7)).toBe(2);
  });

  it("gives every day of the same aligned week the same number", () => {
    const monday = Temporal.PlainDate.from("2025-01-06");
    for (let offset = 0; offset < 7; offset++) {
      expect(weekNumberForDate(monday.add({ days: offset }), 1)).toBe(2);
    }
  });
});
