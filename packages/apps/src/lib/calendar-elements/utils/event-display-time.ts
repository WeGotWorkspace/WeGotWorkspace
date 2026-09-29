import { Temporal } from "@js-temporal/polyfill";

/** Max wall-clock gap between two IANA zones is 26h (UTC+14 vs UTC−12). */
const DISPLAY_ZONE_PAD = { hours: 26 };

export type EventDisplayTimeFields = {
  allDay?: boolean;
  timeZone?: string;
};

function trimZone(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Reinterpret a wall clock from `fromTimeZone` into `toTimeZone`.
 * Missing/equal zones, or a failed Temporal conversion, leave the wall clock put.
 */
export function wallClockInTimeZone(
  wall: Temporal.PlainDateTime,
  fromTimeZone: string | null | undefined,
  toTimeZone: string | null | undefined,
): Temporal.PlainDateTime {
  const from = trimZone(fromTimeZone);
  const to = trimZone(toTimeZone);
  if (!from || !to || from === to) return wall;
  try {
    return wall.toZonedDateTime(from).withTimeZone(to).toPlainDateTime();
  } catch {
    return wall;
  }
}

/** Timed events with a zone convert into the calendar display zone; all-day and floating stay. */
export function eventOccurrenceInDisplayZone(
  wall: Temporal.PlainDateTime,
  event: EventDisplayTimeFields,
  displayTimeZone: string,
): Temporal.PlainDateTime {
  if (event.allDay) return wall;
  return wallClockInTimeZone(wall, event.timeZone, displayTimeZone);
}

/** Inverse of {@link eventOccurrenceInDisplayZone} for drag/resize commits. */
export function displayOccurrenceInEventZone(
  wall: Temporal.PlainDateTime,
  event: EventDisplayTimeFields,
  displayTimeZone: string,
): Temporal.PlainDateTime {
  if (event.allDay) return wall;
  return wallClockInTimeZone(wall, displayTimeZone, event.timeZone);
}

/** Shift a display-zone span by seconds, then convert both edges back to the event zone. */
export function shiftDisplayRangeInEventZone(
  displayStart: Temporal.PlainDateTime,
  displayEnd: Temporal.PlainDateTime,
  event: EventDisplayTimeFields,
  displayTimeZone: string,
  deltaSeconds: number,
): { start: Temporal.PlainDateTime; end: Temporal.PlainDateTime } {
  return {
    start: displayOccurrenceInEventZone(
      displayStart.add({ seconds: deltaSeconds }),
      event,
      displayTimeZone,
    ),
    end: displayOccurrenceInEventZone(
      displayEnd.add({ seconds: deltaSeconds }),
      event,
      displayTimeZone,
    ),
  };
}

export function padRangeForDisplayZone(range: {
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
}): { start: Temporal.PlainDateTime; end: Temporal.PlainDateTime } {
  return {
    start: range.start.subtract(DISPLAY_ZONE_PAD),
    end: range.end.add(DISPLAY_ZONE_PAD),
  };
}

export function dateTimesOverlapRange(
  start: Temporal.PlainDateTime,
  end: Temporal.PlainDateTime,
  rangeStart: Temporal.PlainDateTime,
  rangeEnd: Temporal.PlainDateTime,
): boolean {
  return (
    Temporal.PlainDateTime.compare(end, start) > 0 &&
    Temporal.PlainDateTime.compare(start, rangeEnd) < 0 &&
    Temporal.PlainDateTime.compare(end, rangeStart) > 0
  );
}
