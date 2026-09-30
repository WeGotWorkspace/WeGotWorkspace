/**
 * Curated IANA zones shared by Calendar event editors and Calendar display settings.
 * Lives in `lib/` so settings-core can list them without importing calendar-core.
 */

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

export function commonTimeZoneOptions(
  locale: string,
  currentTimeZone?: string | null,
): TimeZoneOption[] {
  const options: TimeZoneOption[] = COMMON_EVENT_TIME_ZONES.map((id) => ({
    value: id,
    label: formatTimeZoneLabel(id, locale),
  }));
  const current = currentTimeZone?.trim();
  if (
    current &&
    !COMMON_EVENT_TIME_ZONES.includes(current as CommonEventTimeZone) &&
    current !== "UTC"
  ) {
    options.push({ value: current, label: formatTimeZoneLabel(current, locale) });
  }
  return options;
}
