import { Temporal } from "@js-temporal/polyfill";
import { parseRecurrenceId, toRecurrenceId } from "@/lib/calendar-engine";
import type { JSCalendarDuration, JSCalendarLocalDateTime } from "../jscalendar/types.js";

/** "2026-01-15T09:00:00" (no offset, no fractional seconds). */
export function plainDateTimeToLocal(value: Temporal.PlainDateTime): JSCalendarLocalDateTime {
  return value.round({ smallestUnit: "second", roundingMode: "floor" }).toString();
}

export function localToPlainDateTime(value: JSCalendarLocalDateTime): Temporal.PlainDateTime {
  return Temporal.PlainDateTime.from(value);
}

export function durationToJs(value: Temporal.Duration): JSCalendarDuration {
  return value.toString();
}

export function jsToDuration(value: JSCalendarDuration): Temporal.Duration {
  return Temporal.Duration.from(value);
}

/**
 * JSCalendar recurrence ids are LocalDateTime strings; the internal model uses compact
 * `YYYYMMDD` (all-day) / `YYYYMMDDTHHMMSS` ids (see events-api `toRecurrenceId`).
 */
export function localToInternalRecurrenceId(
  value: JSCalendarLocalDateTime,
  allDay: boolean,
): string {
  return toRecurrenceId(localToPlainDateTime(value), allDay);
}

export function internalRecurrenceIdToLocal(
  recurrenceId: string,
  allDay: boolean,
  templateStart: Temporal.PlainDateTime,
): JSCalendarLocalDateTime | null {
  const parsed = parseRecurrenceId(recurrenceId, allDay, templateStart);
  if (!parsed) return null;
  return plainDateTimeToLocal(parsed);
}
