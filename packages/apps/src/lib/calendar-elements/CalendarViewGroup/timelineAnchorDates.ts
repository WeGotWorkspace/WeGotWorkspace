import { Temporal } from "@js-temporal/polyfill";

/**
 * Pure mapping from the view group's month/year integers to the timeline month-mode anchor:
 * the first day of that month (the timeline aligns its own 42-cell window from it).
 */
export function monthAnchorDate(year: number, month: number): Temporal.PlainDate {
  return Temporal.PlainDate.from({ year, month, day: 1 });
}

/**
 * Pure mapping from the view group's year integer to the timeline year-mode anchor:
 * January 1st (year mode composes the twelve months of the anchor's calendar year).
 */
export function yearAnchorDate(year: number): Temporal.PlainDate {
  return Temporal.PlainDate.from({ year, month: 1, day: 1 });
}
