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
    expect(label).toMatch(/Thursday/);
    expect(label).toMatch(/August/);
    expect(label).toMatch(/20/);
  });

  it("shortens the weekday and month on compact day labels", () => {
    const label = calendarRangeLabel({
      view: "day",
      anchor: thursday,
      locale: "en-US",
      density: "compact",
    });
    expect(label).toMatch(/Thu/);
    expect(label).not.toMatch(/Thursday/);
    expect(label).toMatch(/Aug/);
    expect(label).not.toMatch(/August/);
    expect(label).toMatch(/20/);
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
