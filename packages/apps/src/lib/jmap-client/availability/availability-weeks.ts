import { Temporal } from "@js-temporal/polyfill";
import { isInstantOrOffset, localToPlainDateTime } from "../mapping/datetime.js";
import type { JmapBusyPeriod } from "./types.js";

/** Server bounds for `TeamMember/getAvailability` (spec.md, Calculator, Bounds). */
export const AVAILABILITY_MAX_WEEKS_PER_CALL = 54;
export const AVAILABILITY_MAX_IDS_PER_CALL = 50;
export const AVAILABILITY_MAX_PERSON_WEEKS_PER_CALL = 540;
/** Current week plus the next 4 weeks. */
export const AVAILABILITY_PREFETCH_WEEKS = 5;

/**
 * A UTC week is named by its Monday (`YYYY-MM-DD`). Every request covers whole
 * weeks from Monday 00:00 UTC, so the server cache keys stay canonical.
 */
export type UtcWeekStart = string;

/** Floating and all-day times land somewhere between UTC−12 and UTC+14. */
const FLOATING_EARLIEST_OFFSET = Temporal.Duration.from({ hours: 14 });
const FLOATING_LATEST_OFFSET = Temporal.Duration.from({ hours: 12 });

function mondayOf(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - 1 });
}

export function utcWeekStartOfInstant(instant: Temporal.Instant): UtcWeekStart {
  return mondayOf(instant.toZonedDateTimeISO("UTC").toPlainDate()).toString();
}

export function addUtcWeeks(week: UtcWeekStart, count: number): UtcWeekStart {
  return Temporal.PlainDate.from(week).add({ weeks: count }).toString();
}

/** `2026-11-09` → `2026-11-09T00:00:00Z`, the wire form of a week boundary. */
export function utcWeekToWire(week: UtcWeekStart): string {
  return `${week}T00:00:00Z`;
}

function weekStartInstant(week: UtcWeekStart): Temporal.Instant {
  return Temporal.Instant.from(utcWeekToWire(week));
}

/** Every UTC week overlapping `[start, end)`; a zero-length span is its start week. */
export function utcWeeksOverlapping(
  start: Temporal.Instant,
  end: Temporal.Instant,
): UtcWeekStart[] {
  const first = utcWeekStartOfInstant(start);
  const weeks = [first];
  let next = addUtcWeeks(first, 1);
  while (Temporal.Instant.compare(weekStartInstant(next), end) < 0) {
    weeks.push(next);
    next = addUtcWeeks(next, 1);
  }
  return weeks;
}

/**
 * The UTC weeks a period of days needs, in any viewer time zone: the dates are
 * widened by one day each side, which covers every offset from UTC−12 to UTC+14.
 */
export function utcWeeksForDates(
  start: Temporal.PlainDate,
  endExclusive: Temporal.PlainDate,
): UtcWeekStart[] {
  const toInstant = (date: Temporal.PlainDate) =>
    date.toZonedDateTime({ timeZone: "UTC" }).toInstant();
  return utcWeeksOverlapping(
    toInstant(start.subtract({ days: 1 })),
    toInstant(endExclusive.add({ days: 1 })),
  );
}

/** The current UTC week plus the next four. */
export function prefetchUtcWeeks(now: Temporal.Instant): UtcWeekStart[] {
  const first = utcWeekStartOfInstant(now);
  return Array.from({ length: AVAILABILITY_PREFETCH_WEEKS }, (_, index) =>
    addUtcWeeks(first, index),
  );
}

/** Sorted, de-duplicated weeks cut into contiguous runs of at most 54 weeks. */
export function contiguousUtcWeekRuns(weeks: readonly UtcWeekStart[]): UtcWeekStart[][] {
  const sorted = [...new Set(weeks)].sort();
  const runs: UtcWeekStart[][] = [];
  let current: UtcWeekStart[] = [];
  for (const week of sorted) {
    const previous = current[current.length - 1];
    const continues = previous !== undefined && addUtcWeeks(previous, 1) === week;
    if (!continues || current.length >= AVAILABILITY_MAX_WEEKS_PER_CALL) {
      if (current.length > 0) runs.push(current);
      current = [];
    }
    current.push(week);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

export type AvailabilityCallPlan = {
  ids: string[];
  weeks: UtcWeekStart[];
  utcStart: string;
  utcEnd: string;
};

/**
 * One call per run and batch of people, so `ids × weeks` stays within 540 and
 * at most 50 ids go in one call. A year of 12 people is two calls.
 */
export function planAvailabilityCalls(
  ids: readonly string[],
  weeks: readonly UtcWeekStart[],
): AvailabilityCallPlan[] {
  const people = [...new Set(ids)];
  if (people.length === 0) return [];
  const plans: AvailabilityCallPlan[] = [];
  for (const run of contiguousUtcWeekRuns(weeks)) {
    const batchSize = Math.max(
      1,
      Math.min(
        AVAILABILITY_MAX_IDS_PER_CALL,
        Math.floor(AVAILABILITY_MAX_PERSON_WEEKS_PER_CALL / run.length),
      ),
    );
    const utcStart = utcWeekToWire(run[0]!);
    const utcEnd = utcWeekToWire(addUtcWeeks(run[run.length - 1]!, 1));
    for (let index = 0; index < people.length; index += batchSize) {
      plans.push({ ids: people.slice(index, index + batchSize), weeks: run, utcStart, utcEnd });
    }
  }
  return plans;
}

/**
 * The instants a period can cover. Zoned periods are exact; floating and
 * all-day periods are widened to every offset a viewer can have.
 */
export function busyPeriodUtcSpan(period: JmapBusyPeriod): {
  start: Temporal.Instant;
  end: Temporal.Instant;
} {
  const duration = Temporal.Duration.from(period.duration);
  if (!period.showWithoutTime && isInstantOrOffset(period.start.trim())) {
    const instant = Temporal.Instant.from(period.start.trim());
    return { start: instant, end: instant.toZonedDateTimeISO("UTC").add(duration).toInstant() };
  }
  const start = localToPlainDateTime(period.start);
  if (period.timeZone && !period.showWithoutTime) {
    try {
      const zoned = start.toZonedDateTime(period.timeZone);
      return { start: zoned.toInstant(), end: zoned.add(duration).toInstant() };
    } catch {
      // Unknown zone: fall through to the widened floating span.
    }
  }
  const asUtc = (value: Temporal.PlainDateTime) => value.toZonedDateTime("UTC").toInstant();
  return {
    start: asUtc(start).subtract(FLOATING_EARLIEST_OFFSET),
    end: asUtc(start.add(duration)).add(FLOATING_LATEST_OFFSET),
  };
}

/** Every UTC week a period overlaps, in order. The first one is its home week. */
export function busyPeriodUtcWeeks(period: JmapBusyPeriod): UtcWeekStart[] {
  const span = busyPeriodUtcSpan(period);
  return utcWeeksOverlapping(span.start, span.end);
}

/**
 * Files a run's periods under every week of the run they overlap, so a period
 * past Monday 00:00 UTC keeps both weeks busy offline. Weeks with nothing are
 * present with an empty list: fetched and free. Weeks outside the run get no
 * entry, so they still read as never fetched.
 */
export function splitBusyPeriodsByWeek(
  periods: readonly JmapBusyPeriod[],
  runWeeks: readonly UtcWeekStart[],
): Map<UtcWeekStart, JmapBusyPeriod[]> {
  const byWeek = new Map<UtcWeekStart, JmapBusyPeriod[]>(runWeeks.map((week) => [week, []]));
  for (const period of periods) {
    for (const week of busyPeriodUtcWeeks(period)) {
      byWeek.get(week)?.push(period);
    }
  }
  return byWeek;
}

/** What makes two cached periods the same block on the grid. */
function busyPeriodIdentity(period: JmapBusyPeriod): string {
  return JSON.stringify([
    period.start,
    period.timeZone ?? null,
    period.duration,
    period.showWithoutTime,
    period.title ?? null,
    period.location ?? null,
  ]);
}

/**
 * Joins cached weeks into one period list, oldest week first. Identical
 * periods (same start, zone, duration, all-day flag, title and location) come
 * once, so a period stored under two weeks is drawn once.
 */
export function mergeWeekPeriods(
  weeks: readonly { weekStart: UtcWeekStart; periods: readonly JmapBusyPeriod[] }[],
): JmapBusyPeriod[] {
  const seen = new Set<string>();
  const merged: JmapBusyPeriod[] = [];
  for (const week of [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart))) {
    for (const period of week.periods) {
      const identity = busyPeriodIdentity(period);
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push(period);
    }
  }
  return merged;
}
