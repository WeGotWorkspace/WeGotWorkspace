import { Temporal } from "@js-temporal/polyfill";
import { parseRecurrenceId, toRecurrenceId } from "@/lib/calendar-engine";
import type { JSCalendarDuration, JSCalendarLocalDateTime } from "../jscalendar/types.js";

/** Instant `Z` / `z` — Temporal.PlainDateTime.from rejects these. */
const INSTANT_Z = /[zZ]$/;

/** Numeric offset only after a time (`T…+02:00`). `-DD` of `YYYY-MM-DD` is not an offset. */
const OFFSET_AFTER_TIME = /T.*[+-]\d{2}(?::?\d{2})?$/;

/** JSCalendar / RFC 9557 LocalDate with month precision (`2026-10`). */
const YEAR_MONTH = /^\d{4}-\d{2}$/;

/** "2026-01-15T09:00:00" (no offset, no fractional seconds). */
export function plainDateTimeToLocal(value: Temporal.PlainDateTime): JSCalendarLocalDateTime {
  return value.round({ smallestUnit: "second", roundingMode: "floor" }).toString();
}

function isInstantOrOffset(value: string): boolean {
  return INSTANT_Z.test(value) || OFFSET_AFTER_TIME.test(value);
}

/** Month-precision LocalDate → first of that month. Silent — not a warning path. */
function expandPartialLocal(value: string): string {
  return YEAR_MONTH.test(value) ? `${value}-01` : value;
}

/**
 * JSCalendar LocalDateTime, plus Instant/`…Z` (and offset) strings from CalDAV/seed.
 * Instant values become the UTC wall-clock PlainDateTime the engine stores.
 * Date-only `YYYY-MM-DD` stays that day; `YYYY-MM` is day 1 of the month.
 */
export function localToPlainDateTime(value: JSCalendarLocalDateTime): Temporal.PlainDateTime {
  const trimmed = typeof value === "string" ? value.trim() : String(value);
  if (isInstantOrOffset(trimmed)) {
    try {
      return Temporal.Instant.from(trimmed).toZonedDateTimeISO("UTC").toPlainDateTime();
    } catch {
      const withoutOffset = trimmed.replace(/[zZ]$|[+-]\d{2}(?::?\d{2})?$/, "");
      return Temporal.PlainDateTime.from(expandPartialLocal(withoutOffset));
    }
  }
  return Temporal.PlainDateTime.from(expandPartialLocal(trimmed));
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
