/**
 * Curated IANA time zones for the event editor, plus floating/local wall time.
 * Wire shape follows JSCalendar: omit/`null` = floating; IANA id (incl. UTC) = fixed zone.
 */

/** Select sentinel for floating / wall-clock local (no fixed TZID). */
export const FLOATING_TIME_ZONE_VALUE = "floating";

/** Modest list of common zones; UTC first among fixed zones. */
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

/** Normalize synonymous UTC ids so the dropdown and patches stay stable. */
export function normalizeEventTimeZone(timeZone: string | null | undefined): string | null {
  if (timeZone == null || timeZone.trim() === "") return null;
  const trimmed = timeZone.trim();
  if (trimmed === "Etc/UTC" || trimmed === "Etc/GMT" || trimmed === "GMT") return "UTC";
  return trimmed;
}

export function eventTimeZoneSelectValue(timeZone: string | null | undefined): string {
  return normalizeEventTimeZone(timeZone) ?? FLOATING_TIME_ZONE_VALUE;
}

export function eventTimeZoneFromSelectValue(value: string): string | null {
  if (value === FLOATING_TIME_ZONE_VALUE) return null;
  return normalizeEventTimeZone(value);
}

function displayNameForTimeZone(timeZone: string, locale: string): string | null {
  try {
    // TS lib typings lag the runtime: `timeZone` is valid on modern engines.
    const names = new Intl.DisplayNames([locale], {
      type: "timeZone" as unknown as Intl.DisplayNamesOptions["type"],
    });
    return names.of(timeZone) ?? null;
  } catch {
    return null;
  }
}

/** Readable label for an IANA zone; falls back to the id. */
export function formatEventTimeZoneLabel(timeZone: string, locale: string): string {
  const normalized = normalizeEventTimeZone(timeZone) ?? timeZone;
  if (normalized === "UTC") return "UTC";
  const display = displayNameForTimeZone(normalized, locale);
  if (display && display !== normalized) return `${display} (${normalized})`;
  return normalized.replaceAll("_", " ");
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
