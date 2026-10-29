import { Temporal } from "@js-temporal/polyfill";
import { expandEvents, type CalendarEventsMap } from "@/lib/calendar-engine";
import { jmapEventToInternalRows, type JmapCalendarEvent } from "@/lib/jmap-client";
import { isInstantOrOffset, localToPlainDateTime } from "@/lib/jmap-client/mapping/datetime";

/**
 * Which events the client holds: a bootstrap window around today, plus each
 * period the user opens outside it (#1675). Dates are UTC instants.
 */
export type CalendarUtcRange = {
  /** Inclusive lower bound (UTC). */
  utcStart: Date;
  /** Exclusive upper bound (UTC). */
  utcEnd: Date;
};

/** Cached-events window relative to today. */
const WINDOW_MONTHS_BACK = 12;
const WINDOW_MONTHS_AHEAD = 24;

/** Floating times and zone offsets can shift an event by up to a day. */
const EDGE_MARGIN_MS = 24 * 60 * 60 * 1000;

export function plainDateToUtc(date: Temporal.PlainDate): Date {
  return new Date(`${date.toString()}T00:00:00Z`);
}

/** The window the bootstrap loads: 12 months back to 24 months ahead of today. */
export function calendarBootstrapWindow(
  today: Temporal.PlainDate = Temporal.Now.plainDateISO(),
): CalendarUtcRange {
  const start = today.subtract({ months: WINDOW_MONTHS_BACK }).with({ day: 1 });
  const end = today.add({ months: WINDOW_MONTHS_AHEAD }).with({ day: 1 });
  return { utcStart: plainDateToUtc(start), utcEnd: plainDateToUtc(end) };
}

export function isUtcRangeInside(inner: CalendarUtcRange, outer: CalendarUtcRange): boolean {
  return (
    inner.utcStart.getTime() >= outer.utcStart.getTime() &&
    inner.utcEnd.getTime() <= outer.utcEnd.getTime()
  );
}

/**
 * Epoch ms of a JSCalendar date-time. CalDAV clients that store UTC (Apple,
 * Google, Thunderbird) come back as `…Z` with no time zone, and an offset is
 * an instant too. Anything else is wall-clock time in the event's zone.
 */
function zonedStartMs(localDateTime: string, timeZone: string | null | undefined): number {
  const trimmed = localDateTime.trim();
  if (isInstantOrOffset(trimmed)) {
    try {
      return Temporal.Instant.from(trimmed).epochMilliseconds;
    } catch {
      // Not a full instant (a date with an offset): read it as UTC wall-clock time below.
    }
  }
  const local = localToPlainDateTime(trimmed);
  try {
    return local.toZonedDateTime(timeZone || "UTC").epochMilliseconds;
  } catch {
    return local.toZonedDateTime("UTC").epochMilliseconds;
  }
}

const DURATION_REFERENCE_DATE = Temporal.PlainDate.from("2000-01-01");

function eventLengthMs(event: JmapCalendarEvent, startMs: number): number {
  try {
    if (event.duration) {
      return Temporal.Duration.from(event.duration).total({
        unit: "milliseconds",
        relativeTo: DURATION_REFERENCE_DATE,
      });
    }
    if (typeof event.end === "string") {
      return Math.max(0, zonedStartMs(event.end, event.timeZone) - startMs);
    }
  } catch {
    // Unparsable length: treat the event as a point in time.
  }
  return 0;
}

export function isRecurringMaster(event: JmapCalendarEvent): boolean {
  return (
    (event.recurrenceRules?.length ?? 0) > 0 ||
    Object.keys(event.recurrenceOverrides ?? {}).length > 0
  );
}

function utcPlainDateTime(epochMs: number): Temporal.PlainDateTime {
  return Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO("UTC")
    .toPlainDateTime();
}

/** Expand the series over [startMs, endMs) the way the views do; any occurrence counts. */
function seriesHasOccurrenceBetween(
  event: JmapCalendarEvent,
  startMs: number,
  endMs: number,
): boolean {
  try {
    const rows: CalendarEventsMap = new Map();
    for (const row of jmapEventToInternalRows(event)) rows.set(row.key, row.event);
    const range = { start: utcPlainDateTime(startMs), end: utcPlainDateTime(endMs) };
    return expandEvents(rows, range).size > 0;
  } catch {
    return false;
  }
}

/**
 * True only when a `CalendarEvent/query` for `range` certainly returns this
 * event while the server still has it. A cached event the response omitted
 * may then be dropped. Everything else errs towards false (keep):
 *
 * - The check runs a day inside the range, so floating times and zone offsets
 *   at the edges never count.
 * - A recurring master counts only when the series has an occurrence there
 *   (the server answers per occurrence too); `count`, a missing `until` or
 *   overrides alone do not.
 * - An event whose start cannot be read never counts.
 */
export function rangeQueryCoversEvent(event: JmapCalendarEvent, range: CalendarUtcRange): boolean {
  const innerStart = range.utcStart.getTime() + EDGE_MARGIN_MS;
  const innerEnd = range.utcEnd.getTime() - EDGE_MARGIN_MS;
  if (innerEnd <= innerStart) return false;
  if (isRecurringMaster(event)) return seriesHasOccurrenceBetween(event, innerStart, innerEnd);
  let startMs: number;
  try {
    startMs = zonedStartMs(event.start, event.timeZone);
  } catch {
    return false;
  }
  const endMs = startMs + eventLengthMs(event, startMs);
  return startMs < innerEnd && (endMs > innerStart || startMs >= innerStart);
}
