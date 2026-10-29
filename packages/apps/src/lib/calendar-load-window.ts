import { Temporal } from "@js-temporal/polyfill";
import type { JmapCalendarEvent } from "@/lib/jmap-client";

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

/** Floating times and zone lookups can shift an event by up to a day. */
const EVENT_SPAN_PADDING_MS = 24 * 60 * 60 * 1000;

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

function zonedStartMs(localDateTime: string, timeZone: string | null | undefined): number {
  const local = Temporal.PlainDateTime.from(localDateTime);
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
    // Unparsable length: treat as a point in time; the span padding still applies.
  }
  return 0;
}

/** Last instant a series can occur: the latest `until`, or open-ended. */
function seriesEndMs(event: JmapCalendarEvent, length: number): number {
  const rules = event.recurrenceRules ?? [];
  const overrides = Object.keys(event.recurrenceOverrides ?? {});
  if (rules.length === 0 && overrides.length === 0) return Number.NaN;
  if (overrides.length > 0) return Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const rule of rules) {
    const until = (rule as { until?: unknown }).until;
    if (typeof until !== "string") return Number.POSITIVE_INFINITY;
    latest = Math.max(latest, zonedStartMs(until, event.timeZone) + length);
  }
  return latest;
}

export function isRecurringCalendarEvent(event: JmapCalendarEvent): boolean {
  return (
    (event.recurrenceRules ?? []).length > 0 ||
    Object.keys(event.recurrenceOverrides ?? {}).length > 0
  );
}

/**
 * Whether a non-recurring event's own start/end intersect `range`, with no
 * padding: the test for "the server query would have returned it". False for
 * recurring events and for dates it cannot read.
 */
export function calendarEventIntersectsRange(
  event: JmapCalendarEvent,
  range: CalendarUtcRange,
): boolean {
  if (isRecurringCalendarEvent(event)) return false;
  try {
    const startMs = zonedStartMs(event.start, event.timeZone);
    const endMs = startMs + eventLengthMs(event, startMs);
    const rangeStart = range.utcStart.getTime();
    const rangeEnd = range.utcEnd.getTime();
    return endMs > startMs
      ? startMs < rangeEnd && endMs > rangeStart
      : startMs >= rangeStart && startMs < rangeEnd;
  } catch {
    return false;
  }
}

/**
 * Whether the event may have an occurrence inside `range`. Errs towards true
 * (open-ended series, unparsable dates): a caller that drops events "inside a
 * fetched range but missing from its response" then defers to the server.
 */
export function calendarEventMayOverlapRange(
  event: JmapCalendarEvent,
  range: CalendarUtcRange,
): boolean {
  let startMs: number;
  try {
    startMs = zonedStartMs(event.start, event.timeZone);
  } catch {
    return true;
  }
  const length = eventLengthMs(event, startMs);
  const seriesEnd = seriesEndMs(event, length);
  const endMs = Number.isNaN(seriesEnd) ? startMs + length : seriesEnd;
  return (
    startMs - EVENT_SPAN_PADDING_MS < range.utcEnd.getTime() &&
    endMs + EVENT_SPAN_PADDING_MS > range.utcStart.getTime()
  );
}
