import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { calendarRangeLabel } from "./calendar-range-label";

const monday = Temporal.PlainDate.from("2026-08-17");
const thursday = Temporal.PlainDate.from("2026-08-20");

describe("calendarRangeLabel", () => {
  it("uses month, day, and year on full day labels without a weekday", () => {
    const label = calendarRangeLabel({
      view: "day",
      anchor: thursday,
      locale: "en-US",
    });
    expect(label).toBe("August 20, 2026");
  });

  it("shortens the month on compact day labels but keeps the year and omits the weekday", () => {
    const label = calendarRangeLabel({
      view: "day",
      anchor: thursday,
      locale: "en-US",
      density: "compact",
    });
    expect(label).toBe("Aug 20, 2026");
  });

  it("formats week ranges without weekday names", () => {
    const sunday = monday.add({ days: 6 });
    const full = calendarRangeLabel({
      view: "week",
      anchor: thursday,
      locale: "en-US",
      weekStart: monday,
      weekEnd: sunday,
    });
    const compact = calendarRangeLabel({
      view: "week",
      anchor: thursday,
      locale: "en-US",
      density: "compact",
      weekStart: monday,
      weekEnd: sunday,
    });
    expect(full).toBe("Aug 17-23, 2026");
    expect(compact).toBe("17–23 Aug 2026");
  });

  it("keeps month and year titles as month + year or year only", () => {
    expect(
      calendarRangeLabel({
        view: "month",
        anchor: thursday,
        locale: "en-US",
      }),
    ).toBe("August 2026");
    expect(
      calendarRangeLabel({
        view: "year",
        anchor: thursday,
        locale: "en-US",
      }),
    ).toBe("2026");
  });
});
