import { Temporal } from "@js-temporal/polyfill";
import {
  calendarRangeLabel,
  type CalendarRangeLabelDensity,
} from "@/lib/calendar-elements/CalendarViewGroup/calendar-range-label";
import { viewDateRange } from "@/calendar-core/src/calendar-event-model";
import type { CalendarViewId } from "@/calendar-core/src/calendar-types";

export function calendarViewRangeTitle(
  view: CalendarViewId,
  anchorISO: string,
  locale: string,
  density: CalendarRangeLabelDensity = "full",
  weekStart = 1,
): string {
  const anchor = Temporal.PlainDate.from(anchorISO);
  if (view !== "week") {
    return calendarRangeLabel({ view, anchor, locale, density });
  }
  const range = viewDateRange(view, anchorISO, weekStart);
  return calendarRangeLabel({
    view,
    anchor,
    locale,
    density,
    weekStart: range.start,
    weekEnd: range.end.subtract({ days: 1 }),
  });
}
