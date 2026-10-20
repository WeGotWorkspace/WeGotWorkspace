import { describe, expect, it } from "vitest";
import {
  dayHeaderAriaLabel,
  monthDayHeaderAriaLabel,
} from "@/lib/calendar-elements/CalendarTimelineView/day-header-aria-label";

const fullDate = (date: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(date);

describe("day header aria labels", () => {
  it("leads the single-timeline name with the visible weekday and day", () => {
    const date = new Date(Date.UTC(2026, 7, 9));
    expect(dayHeaderAriaLabel("en-US", date, "Sun 9")).toBe(`Sun 9, ${fullDate(date)}`);
  });

  it("names a plain month day by its full date", () => {
    const date = new Date(Date.UTC(2026, 7, 9));
    expect(monthDayHeaderAriaLabel("en-US", date)).toBe(fullDate(date));
  });

  it("leads the 1st of the month with the visible month boundary", () => {
    const date = new Date(Date.UTC(2026, 7, 1));
    const boundary = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
      date,
    );
    expect(monthDayHeaderAriaLabel("en-US", date)).toBe(`${boundary}, ${fullDate(date)}`);
  });
});
