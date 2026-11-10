/**
 * IANA zones shared by the Calendar event editor, the Tasks due field and Calendar
 * display settings. Lives in `lib/` so settings-core can list them without
 * importing calendar-core.
 */

/** Fallback when the runtime cannot list its zones (`Intl.supportedValuesOf`). */

export const COMMON_EVENT_TIME_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Athens",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

export type CommonEventTimeZone = (typeof COMMON_EVENT_TIME_ZONES)[number];

function displayNameForTimeZone(timeZone: string, locale: string): string | null {
  try {
    const names = new Intl.DisplayNames([locale], {
      type: "timeZone" as unknown as Intl.DisplayNamesOptions["type"],
    });
    return names.of(timeZone) ?? null;
  } catch {
    return null;
  }
}

/** Readable label for an IANA zone; falls back to the id. */
export function formatTimeZoneLabel(timeZone: string, locale: string): string {
  if (timeZone === "UTC") return "UTC";
  const display = displayNameForTimeZone(timeZone, locale);
  if (display && display !== timeZone) return `${display} (${timeZone})`;
  return timeZone.replaceAll("_", " ");
}

export type TimeZoneOption = {
  value: string;
  label: string;
};

let allTimeZoneIdsCache: readonly string[] | null = null;

/** Every IANA zone the runtime knows, plus UTC (which `Intl` leaves out). */
export function allTimeZoneIds(): readonly string[] {
  if (allTimeZoneIdsCache) return allTimeZoneIdsCache;
  const ids =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [...COMMON_EVENT_TIME_ZONES];
  allTimeZoneIdsCache = [...new Set(["UTC", ...ids])];
  return allTimeZoneIdsCache;
}

/**
 * Every zone, sorted by its label, plus the current value when the runtime does
 * not list it (an older or legacy id read from the server).
 */
export function timeZoneOptions(locale: string, currentTimeZone?: string | null): TimeZoneOption[] {
  const ids = [...allTimeZoneIds()];
  const current = currentTimeZone?.trim();
  if (current && !ids.includes(current)) ids.push(current);
  return ids
    .map((id) => ({ value: id, label: formatTimeZoneLabel(id, locale) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}
