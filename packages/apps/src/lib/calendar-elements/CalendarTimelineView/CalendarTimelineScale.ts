import { Temporal } from "@js-temporal/polyfill";

const MINUTES_PER_DAY = 24 * 60;

export type CalendarTimelineScale = {
  startDate: Temporal.PlainDate;
  numDays: number;
  unitsPerDay: number;
};

function normalizeScale(scale: CalendarTimelineScale): {
  startDateTime: Temporal.PlainDateTime;
  unitsPerDay: number;
  numDays: number;
} {
  const startDateTime = scale.startDate.toPlainDateTime(Temporal.PlainTime.from("00:00"));
  const unitsPerDay = Math.max(1, Math.floor(Number(scale.unitsPerDay) || 1));
  const numDays = Math.max(1, Math.floor(Number(scale.numDays) || 1));
  return { startDateTime, unitsPerDay, numDays };
}

/** Converts a wall-clock datetime to absolute timeline units from `scale.startDate`. */
export function toTimelineValue(
  dateTime: Temporal.PlainDateTime,
  scale: CalendarTimelineScale,
): number {
  const { startDateTime, unitsPerDay } = normalizeScale(scale);
  const minutesFromStart = startDateTime.until(dateTime).total({ unit: "minutes" });
  return (minutesFromStart * unitsPerDay) / MINUTES_PER_DAY;
}

/**
 * Expands a single absolute “now” value into one marker per day column at the same
 * time-of-day, so the indicator spans the full timed grid (day and week). Returns `[]`
 * when `absoluteValue` falls outside the rendered range (today not in view).
 */
export function currentTimeMarkersAcrossDays(
  absoluteValue: number,
  unitsPerDay: number,
  numDays: number,
): number[] {
  const dayUnits = Math.max(1, Math.floor(Number(unitsPerDay) || 1));
  const days = Math.max(1, Math.floor(Number(numDays) || 1));
  const gridMax = dayUnits * days;
  if (!Number.isFinite(absoluteValue) || absoluteValue < 0 || absoluteValue >= gridMax) {
    return [];
  }
  const timeOfDay = ((absoluteValue % dayUnits) + dayUnits) % dayUnits;
  return Array.from({ length: days }, (_, day) => day * dayUnits + timeOfDay);
}

/** Converts timeline units back to a wall-clock datetime from `scale.startDate`. */
export function fromTimelineValue(
  timelineValue: number,
  scale: CalendarTimelineScale,
): Temporal.PlainDateTime {
  const { startDateTime, unitsPerDay } = normalizeScale(scale);
  const minutesFromStart = (timelineValue * MINUTES_PER_DAY) / unitsPerDay;
  const wholeMinutes = Math.trunc(minutesFromStart);
  const fractionalSeconds = Math.round((minutesFromStart - wholeMinutes) * 60);
  return startDateTime.add({ minutes: wholeMinutes, seconds: fractionalSeconds });
}

export function toTimelineRange(
  start: Temporal.PlainDateTime,
  end: Temporal.PlainDateTime,
  scale: CalendarTimelineScale,
): { start: number; end: number } {
  return {
    start: toTimelineValue(start, scale),
    end: toTimelineValue(end, scale),
  };
}

function isMidnight(dateTime: Temporal.PlainDateTime): boolean {
  const time = dateTime.toPlainTime();
  return (
    time.hour === 0 &&
    time.minute === 0 &&
    time.second === 0 &&
    time.millisecond === 0 &&
    time.microsecond === 0 &&
    time.nanosecond === 0
  );
}

/**
 * Converts a time range into a day-snapped range:
 * - start snaps to start-of-day of the original start date
 * - end snaps to start-of-next-day when it has a time component
 * This is useful for "all-day plotting" without changing original times.
 */
export function toTimelineAllDayRange(
  start: Temporal.PlainDateTime,
  end: Temporal.PlainDateTime,
  scale: CalendarTimelineScale,
): { start: number; end: number } {
  const dayStart = start.toPlainDate().toPlainDateTime(Temporal.PlainTime.from("00:00"));
  const endDate = isMidnight(end) ? end.toPlainDate() : end.toPlainDate().add({ days: 1 });
  let dayEndExclusive = endDate.toPlainDateTime(Temporal.PlainTime.from("00:00"));
  if (Temporal.PlainDateTime.compare(dayEndExclusive, dayStart) <= 0) {
    dayEndExclusive = dayStart.add({ days: 1 });
  }
  return toTimelineRange(dayStart, dayEndExclusive, scale);
}

/**
 * Render order for day-snapped presentations (month cells, all-day rows), following the common
 * calendar convention (FullCalendar's default `eventOrder: "start,-duration,allDay,title"`,
 * Google/Apple/Outlook month cells): start date first, then longer spans win lower stack rows
 * (so multi-day bars align across cells), then all-day events above timed ones, then timed
 * events by start time, then summary as a stable tie-breaker.
 */
export function compareDaySnappedRenderOrder(
  a: {
    start: Temporal.PlainDateTime;
    end: Temporal.PlainDateTime;
    summary: string;
    allDay: boolean;
  },
  b: {
    start: Temporal.PlainDateTime;
    end: Temporal.PlainDateTime;
    summary: string;
    allDay: boolean;
  },
): number {
  const startDateDiff = Temporal.PlainDate.compare(a.start.toPlainDate(), b.start.toPlainDate());
  if (startDateDiff !== 0) return startDateDiff;

  const aEndDate = a.end.subtract({ nanoseconds: 1 }).toPlainDate();
  const bEndDate = b.end.subtract({ nanoseconds: 1 }).toPlainDate();
  const endDateDiff = Temporal.PlainDate.compare(aEndDate, bEndDate);
  if (endDateDiff !== 0) return -endDateDiff;

  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;

  const startTimeDiff = Temporal.PlainDateTime.compare(a.start, b.start);
  if (startTimeDiff !== 0) return startTimeDiff;

  return a.summary.localeCompare(b.summary);
}

export type TimelineEventFilter = "all" | "all-day-only";

/**
 * Which events a single-timeline presentation should include:
 * - explicit `variant="all-day"` is the standalone all-day presentation → all-day events only
 * - a preset all-day mapping (month mode's day cells) → everything, day-snapped
 *   (grid-month parity: timed events keep their time label, all-day events render as bars)
 * - timed variants (gantt, horizontal timed) → everything, plotted with real ranges
 */
export function resolveTimelineEventFilter(
  explicitVariant: string | undefined,
  resolvedVariant: "timed" | "all-day",
): TimelineEventFilter {
  if (resolvedVariant === "all-day" && explicitVariant === "all-day") return "all-day-only";
  return "all";
}

export function fromTimelineRange(
  start: number,
  end: number,
  scale: CalendarTimelineScale,
): { start: Temporal.PlainDateTime; end: Temporal.PlainDateTime } {
  return {
    start: fromTimelineValue(start, scale),
    end: fromTimelineValue(end, scale),
  };
}

export function timelineGridMax(scale: CalendarTimelineScale): number {
  const { unitsPerDay, numDays } = normalizeScale(scale);
  return unitsPerDay * numDays;
}

/**
 * Week-start-aligned day on or before `anchor` — the first cell of a full-week window
 * (same alignment as `CalendarWeekView#gridStartDate`).
 */
export function alignedWeekStart(
  anchor: Temporal.PlainDate,
  weekStart: number,
): Temporal.PlainDate {
  const weekdayOffset = (anchor.dayOfWeek - weekStart + 7) % 7;
  return anchor.subtract({ days: weekdayOffset });
}

/**
 * First cell of a month grid window: the week-start-aligned day on or before the 1st of
 * `monthAnchor`'s month (same alignment as `CalendarMonthView.startDate`).
 */
export function alignedMonthGridStart(
  monthAnchor: Temporal.PlainDate,
  weekStart: number,
): Temporal.PlainDate {
  return alignedWeekStart(monthAnchor.with({ day: 1 }), weekStart);
}

/**
 * First day of each month (January … December) of `anchor`'s calendar year — the twelve
 * month-mode windows composed by the timeline year view.
 */
export function yearMonthStarts(anchor: Temporal.PlainDate): Temporal.PlainDate[] {
  return Array.from({ length: 12 }, (_, index) => anchor.with({ month: index + 1, day: 1 }));
}

/** True when `day` is a leading/trailing cell outside `anchor`'s calendar month. */
export function isOutsideVisibleMonth(
  day: Temporal.PlainDate,
  anchor: Temporal.PlainDate,
): boolean {
  return day.month !== anchor.month || day.year !== anchor.year;
}

/**
 * Shadow-part list for a month-grid day header. Outside-month cells get
 * `day-header-outside-month` (and never the weekend part — same exclusion as the old
 * `.is-weekend:not(.is-outside-month)` rule).
 */
export function monthDayHeaderPartNames(options: {
  outsideMonth: boolean;
  isWeekend: boolean;
}): string {
  return [
    "day-header",
    "day-header-button",
    options.outsideMonth ? "day-header-outside-month" : "",
    options.isWeekend && !options.outsideMonth ? "day-header-weekend" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Whether a numeric timeline range overlaps day cell `cellIndex`
 * (cell `i` spans `[i * unitsPerDay, (i + 1) * unitsPerDay)`; ranges are `[start, end)`).
 */
export function timelineRangeOverlapsCell(
  range: { start: number; end: number },
  cellIndex: number,
  unitsPerDay: number,
): boolean {
  const units = Math.max(1, Number(unitsPerDay) || 1);
  const cellStart = cellIndex * units;
  return range.start < cellStart + units && range.end > cellStart;
}

/**
 * Grid-parity `visibleHours` zoom: clamped visible hour count (1–24) and first visible hour
 * (clamped so the window stays inside the day). Returns `null` when `visibleHours` is unset or
 * invalid — the consumer then falls back to its default hour sizing. The day/week composition
 * derives its hour height from this (viewport height / hours) and scrolls the remaining hours
 * into view, exactly like the grid week view; `startHour` drives the initial scroll offset.
 */
export function resolveVisibleHoursZoom(
  visibleHours: number | undefined,
  visibleHoursStart?: number,
): { hours: number; startHour: number } | null {
  const hours = Number(visibleHours);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const clampedHours = Math.max(1, Math.min(24, Math.floor(hours)));
  const startRaw = Number(visibleHoursStart);
  const startHour = Number.isFinite(startRaw)
    ? Math.max(0, Math.min(24 - clampedHours, Math.floor(startRaw)))
    : 0;
  return { hours: clampedHours, startHour };
}

/**
 * Vertical scroll offset for the composed day/week timed grid.
 *
 * When `nowDayFraction` is set (today is in the visible range, 0–1 through the day), centers
 * the current-time marker in the timed viewport below the sticky all-day shell. Otherwise
 * scrolls so `fallbackStartHour` is the first visible hour (`visibleHoursStart` parity).
 * Instant assignment (no smooth scroll) — fine for `prefers-reduced-motion`.
 */
export function composedTimedScrollTop(options: {
  timedHeightPx: number;
  timedViewportPx: number;
  timedGapPx?: number;
  nowDayFraction: number | null;
  fallbackStartHour: number;
  maxScrollTop?: number;
}): number {
  const timedHeightPx = Math.max(0, Number(options.timedHeightPx) || 0);
  const timedViewportPx = Math.max(0, Number(options.timedViewportPx) || 0);
  const timedGapPx = Math.max(0, Number(options.timedGapPx) || 0);
  const fallbackStartHour = Number(options.fallbackStartHour);
  const startHour = Number.isFinite(fallbackStartHour)
    ? Math.max(0, Math.min(24, fallbackStartHour))
    : 0;

  let scrollTop: number;
  const fraction = options.nowDayFraction;
  if (fraction != null && Number.isFinite(fraction)) {
    const clampedFraction = Math.max(0, Math.min(1, fraction));
    scrollTop = timedGapPx + timedHeightPx * clampedFraction - timedViewportPx / 2;
  } else {
    scrollTop = (timedHeightPx * startHour) / 24;
  }

  if (!Number.isFinite(scrollTop)) return 0;
  const maxScroll =
    options.maxScrollTop != null && Number.isFinite(options.maxScrollTop)
      ? Math.max(0, options.maxScrollTop)
      : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(maxScroll, scrollTop));
}

/**
 * Maps the grid views' `visibleHours` concept (+ optional start hour) onto TimeLine's per-cell
 * axis window. Returns the full range (`start: 0, end: null`) when `visibleHours` is unset or
 * covers the whole day. The day/week calendar composition no longer uses this (it zooms via
 * `resolveVisibleHoursZoom` and scrolls); the axis window remains a generic TimeLine feature
 * for other consumers.
 */
export function visibleHoursWindow(
  unitsPerDay: number,
  visibleHours: number | undefined,
  visibleHoursStart?: number,
): { windowStart: number; windowEnd: number | null } {
  const hours = Number(visibleHours);
  if (!Number.isFinite(hours) || hours <= 0) return { windowStart: 0, windowEnd: null };
  const clampedHours = Math.max(1, Math.min(24, Math.floor(hours)));
  const startRaw = Number(visibleHoursStart);
  const start = Number.isFinite(startRaw)
    ? Math.max(0, Math.min(24 - clampedHours, Math.floor(startRaw)))
    : 0;
  if (clampedHours >= 24) return { windowStart: 0, windowEnd: null };
  return {
    windowStart: (start / 24) * unitsPerDay,
    windowEnd: ((start + clampedHours) / 24) * unitsPerDay,
  };
}
