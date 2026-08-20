import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { calendarRangeLabel } from "./calendar-range-label";

const monday = Temporal.PlainDate.from("2026-08-17");
const thursday = Temporal.PlainDate.from("2026-08-20");

describe("calendarRangeLabel", () => {
  it("uses a long weekday on full day labels", () => {
    const label = calendarRangeLabel({
      view: "day",
      anchor: thursday,
      locale: "en-US",
    });
    expect(label).toBe("Thursday, August 20, 2026");
  });

  it("shortens the weekday and month on compact day labels but keeps the year", () => {
    const label = calendarRangeLabel({
      view: "day",
      anchor: thursday,
      locale: "en-US",
      density: "compact",
    });
    expect(label).toBe("Thu, Aug 20, 2026");
  });

  it("adds short weekdays on compact week ranges", () => {
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
    expect(full).toMatch(/Aug 17-23/);
    expect(compact).toMatch(/Mon/);
    expect(compact).toMatch(/Sun/);
    expect(compact).toMatch(/17/);
    expect(compact).toMatch(/23/);
  });
});
