import { Temporal } from "@js-temporal/polyfill";
import type { CalendarOccurrence } from "@/calendar-core/src/calendar-event-model";
import type { CalendarDateRange } from "@/calendar-core/src/calendar-event-model";
import { computeStaggerLayout, type StaggerEventLayout } from "./stagger-layout";

/**
 * Pure layout math for the month grid and the week/day timed grids. Ordering
 * follows lit-calendar's `compareDaySnappedRenderOrder` (FullCalendar-style:
 * start date, longer spans first, all-day above timed, then time, then title).
 */

const MINUTES_PER_DAY = 24 * 60;

export function rangeDays(range: CalendarDateRange): Temporal.PlainDate[] {
  const days: Temporal.PlainDate[] = [];
  for (
    let day = range.start;
    Temporal.PlainDate.compare(day, range.end) < 0;
    day = day.add({ days: 1 })
  ) {
    days.push(day);
  }
  return days;
}

export function compareDaySnappedRenderOrder(a: CalendarOccurrence, b: CalendarOccurrence): number {
  const startDateDiff = Temporal.PlainDate.compare(a.start.toPlainDate(), b.start.toPlainDate());
  if (startDateDiff !== 0) return startDateDiff;

  const aEndDate = a.end.subtract({ nanoseconds: 1 }).toPlainDate();
  const bEndDate = b.end.subtract({ nanoseconds: 1 }).toPlainDate();
  const endDateDiff = Temporal.PlainDate.compare(aEndDate, bEndDate);
  if (endDateDiff !== 0) return -endDateDiff;

  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;

  const startTimeDiff = Temporal.PlainDateTime.compare(a.start, b.start);
  if (startTimeDiff !== 0) return startTimeDiff;

  return a.title.localeCompare(b.title);
}

/** Whether an occurrence intersects `[day 00:00, day+1 00:00)`. */
function occurrenceTouchesDay(occurrence: CalendarOccurrence, day: Temporal.PlainDate): boolean {
  const dayStart = day.toPlainDateTime(Temporal.PlainTime.from("00:00"));
  const dayEnd = dayStart.add({ days: 1 });
  const effectiveEnd =
    Temporal.PlainDateTime.compare(occurrence.end, occurrence.start) > 0
      ? occurrence.end
      : occurrence.start.add({ minutes: 1 });
  return (
    Temporal.PlainDateTime.compare(occurrence.start, dayEnd) < 0 &&
    Temporal.PlainDateTime.compare(effectiveEnd, dayStart) > 0
  );
}

export type MonthDayCell = {
  date: Temporal.PlainDate;
  inMonth: boolean;
  isToday: boolean;
  occurrences: CalendarOccurrence[];
};

export function monthGridCells(
  range: CalendarDateRange,
  anchorISO: string,
  occurrences: CalendarOccurrence[],
  today = Temporal.Now.plainDateISO(),
): MonthDayCell[][] {
  const anchorMonth = Temporal.PlainDate.from(anchorISO);
  const sorted = [...occurrences].sort(compareDaySnappedRenderOrder);

  const weeks: MonthDayCell[][] = [];
  let week: MonthDayCell[] = [];
  for (const date of rangeDays(range)) {
    week.push({
      date,
      inMonth: date.month === anchorMonth.month && date.year === anchorMonth.year,
      isToday: Temporal.PlainDate.compare(date, today) === 0,
      occurrences: sorted.filter((occurrence) => occurrenceTouchesDay(occurrence, date)),
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  return weeks;
}

export type TimedBlock = {
  occurrence: CalendarOccurrence;
  /** Percentage offsets within the day column. */
  top: number;
  height: number;
  layout: StaggerEventLayout;
};

export type DayColumn = {
  date: Temporal.PlainDate;
  isToday: boolean;
  allDay: CalendarOccurrence[];
  timed: TimedBlock[];
};

const MIN_BLOCK_MINUTES = 30;

function minutesIntoDay(dateTime: Temporal.PlainDateTime, day: Temporal.PlainDate): number {
  const dayStart = day.toPlainDateTime(Temporal.PlainTime.from("00:00"));
  return Math.max(
    0,
    Math.min(MINUTES_PER_DAY, dayStart.until(dateTime).total({ unit: "minutes" })),
  );
}

/** One column per day: all-day chips plus stagger-positioned timed blocks. */
export function timeGridColumns(
  range: CalendarDateRange,
  occurrences: CalendarOccurrence[],
  today = Temporal.Now.plainDateISO(),
): DayColumn[] {
  const sorted = [...occurrences].sort(compareDaySnappedRenderOrder);

  return rangeDays(range).map((date) => {
    const touching = sorted.filter((occurrence) => occurrenceTouchesDay(occurrence, date));
    const dayStart = date.toPlainDateTime(Temporal.PlainTime.from("00:00"));
    const spansWholeDay = (occurrence: CalendarOccurrence) =>
      Temporal.PlainDateTime.compare(occurrence.start, dayStart) < 0 &&
      Temporal.PlainDateTime.compare(occurrence.end, dayStart.add({ days: 1 })) >= 0;
    const allDay = touching.filter((occurrence) => occurrence.allDay || spansWholeDay(occurrence));
    const timedOccurrences = touching.filter((occurrence) => !allDay.includes(occurrence));

    const intervals = timedOccurrences.map((occurrence) => {
      const start = minutesIntoDay(occurrence.start, date);
      const rawEnd = minutesIntoDay(occurrence.end, date);
      return { start, end: Math.max(rawEnd, start + MIN_BLOCK_MINUTES) };
    });
    const layouts = computeStaggerLayout(intervals);

    const timed: TimedBlock[] = timedOccurrences.map((occurrence, index) => {
      const interval = intervals[index];
      return {
        occurrence,
        top: (interval.start / MINUTES_PER_DAY) * 100,
        height: ((interval.end - interval.start) / MINUTES_PER_DAY) * 100,
        layout: layouts[index],
      };
    });

    return {
      date,
      isToday: Temporal.PlainDate.compare(date, today) === 0,
      allDay,
      timed,
    };
  });
}

/** Inline CSS metrics for a stagger placement (mirrors the reference grid). */
export function staggerBlockMetrics(layout: StaggerEventLayout): {
  leftPercent: number;
  widthPercent: number;
  zIndex: number;
} {
  if (layout.groupSize > 1) {
    const width = 100 / layout.groupSize;
    return { leftPercent: layout.groupIndex * width, widthPercent: width, zIndex: 1 };
  }
  const indentStep = 8;
  const left = Math.min(layout.indent * indentStep, 60);
  return { leftPercent: left, widthPercent: 100 - left, zIndex: 1 + layout.indent };
}
