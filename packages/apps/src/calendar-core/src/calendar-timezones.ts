/**
 * Curated IANA time zones for the event editor, plus floating/local wall time.
 * Wire shape follows JSCalendar: omit/`null` = floating; IANA id (incl. UTC) = fixed zone.
 * New timed events default to {@link defaultTimedEventTimeZone} (device IANA), not floating.
 */

import { Temporal } from "@js-temporal/polyfill";
import {
  COMMON_EVENT_TIME_ZONES,
  formatTimeZoneLabel,
  type CommonEventTimeZone,
} from "@/lib/calendar-time-zones";

export { COMMON_EVENT_TIME_ZONES };
export type { CommonEventTimeZone };

/** Select sentinel for floating / wall-clock local (no fixed TZID). */
export const FLOATING_TIME_ZONE_VALUE = "floating";

/** Normalize synonymous UTC ids so the dropdown and patches stay stable. */
export function normalizeEventTimeZone(timeZone: string | null | undefined): string | null {
  if (timeZone == null || timeZone.trim() === "") return null;
  const trimmed = timeZone.trim();
  if (trimmed === "Etc/UTC" || trimmed === "Etc/GMT" || trimmed === "GMT") return "UTC";
  return trimmed;
}

/**
 * Default IANA zone for new timed events: stored Calendar display zone, else device.
 * Uses `Temporal.Now.timeZoneId()` when `preferred` is empty — not locale-derived, not floating.
 * All-day creates stay date-only / floating as JSCalendar requires.
 */
export function defaultTimedEventTimeZone(preferred?: string | null): string {
  return (
    normalizeEventTimeZone(preferred) ?? normalizeEventTimeZone(Temporal.Now.timeZoneId()) ?? "UTC"
  );
}

export function eventTimeZoneSelectValue(timeZone: string | null | undefined): string {
  return normalizeEventTimeZone(timeZone) ?? FLOATING_TIME_ZONE_VALUE;
}

export function eventTimeZoneFromSelectValue(value: string): string | null {
  if (value === FLOATING_TIME_ZONE_VALUE) return null;
  return normalizeEventTimeZone(value);
}

/** Readable label for an IANA zone; falls back to the id. */
export function formatEventTimeZoneLabel(timeZone: string, locale: string): string {
  const normalized = normalizeEventTimeZone(timeZone) ?? timeZone;
  return formatTimeZoneLabel(normalized, locale);
}

export type EventTimeZoneOption = {
  value: string;
  label: string;
};

/**
 * Options for the dialog select: floating first, then common zones, plus the
 * current value when it is not already in the curated list.
 */
export function eventTimeZoneOptions(
  locale: string,
  floatingLabel: string,
  currentTimeZone?: string | null,
): EventTimeZoneOption[] {
  const options: EventTimeZoneOption[] = [
    { value: FLOATING_TIME_ZONE_VALUE, label: floatingLabel },
    ...COMMON_EVENT_TIME_ZONES.map((id) => ({
      value: id,
      label: formatEventTimeZoneLabel(id, locale),
    })),
  ];
  const current = normalizeEventTimeZone(currentTimeZone);
  if (current && !COMMON_EVENT_TIME_ZONES.includes(current as CommonEventTimeZone)) {
    options.push({ value: current, label: formatEventTimeZoneLabel(current, locale) });
  }
  return options;
}
