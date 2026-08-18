import { Temporal } from "@js-temporal/polyfill";
import type { WeekdayNumber } from "../types/Weekday.js";

/** Week-start-aligned day on or before `date` (same alignment as the calendar views). */
export function startOfWeekFor(
  date: Temporal.PlainDate,
  weekStart: WeekdayNumber,
): Temporal.PlainDate {
  const weekdayOffset = (date.dayOfWeek - weekStart + 7) % 7;
  return date.subtract({ days: weekdayOffset });
}

/**
 * 1-based week number of the week containing `date`, counted from the week that contains
 * January 1st of `date`'s calendar year, with weeks aligned to `weekStart`. Extracted from
 * CalendarViewGroup so its toolbar label and the timeline view's corner week number always
 * agree.
 */
export function weekNumberForDate(date: Temporal.PlainDate, weekStart: WeekdayNumber): number {
  const firstOfYear = Temporal.PlainDate.from({ year: date.year, month: 1, day: 1 });
  const firstWeekStart = startOfWeekFor(firstOfYear, weekStart);
  const startOfSelectedWeek = startOfWeekFor(date, weekStart);
  const diffDays = firstWeekStart.until(startOfSelectedWeek, { largestUnit: "day" }).days;
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}
