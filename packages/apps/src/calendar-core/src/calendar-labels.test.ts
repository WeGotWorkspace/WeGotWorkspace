import { describe, expect, it } from "vitest";
import {
  calendarPeriodNavLabels,
  defaultCalendarLabels,
} from "@/calendar-core/src/calendar-labels";
import type { CalendarViewId } from "@/calendar-core/src/calendar-types";

describe("calendarPeriodNavLabels", () => {
  const cases: Array<{
    view: CalendarViewId;
    previous: string;
    next: string;
  }> = [
    { view: "day", previous: "Previous day", next: "Next day" },
    { view: "week", previous: "Previous week", next: "Next week" },
    { view: "month", previous: "Previous month", next: "Next month" },
    { view: "year", previous: "Previous year", next: "Next year" },
  ];

  it.each(cases)("maps $view to context-aware prev/next labels", ({ view, previous, next }) => {
    expect(calendarPeriodNavLabels(view, defaultCalendarLabels)).toEqual({ previous, next });
  });

  it("uses label overrides when provided", () => {
    expect(
      calendarPeriodNavLabels("week", {
        ...defaultCalendarLabels,
        previousWeek: "Go back one week",
        nextWeek: "Advance one week",
      }),
    ).toEqual({ previous: "Go back one week", next: "Advance one week" });
  });
});
