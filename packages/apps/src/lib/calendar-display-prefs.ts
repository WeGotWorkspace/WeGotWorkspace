import {
  COMMON_EVENT_TIME_ZONES,
  commonTimeZoneOptions,
  formatTimeZoneLabel,
  type CommonEventTimeZone,
} from "@/lib/calendar-time-zones";

export const CALENDAR_DISPLAY_PREFS_STORAGE_KEY = "wgw.ui.calendar.displayPrefs";

export const CALENDAR_DISPLAY_DEVICE_ZONE = "device";
export const CALENDAR_DISPLAY_BROWSER_LOCALE = "browser";
export const CALENDAR_DISPLAY_WORKDAY_UNSET = "unset";

export const CALENDAR_DISPLAY_LOCALES = [
  "en-US",
  "en-GB",
  "nl-NL",
  "de-DE",
  "fr-FR",
  "es-ES",
  "it-IT",
  "pt-BR",
  "ja-JP",
  "zh-CN",
] as const;

export type CalendarDisplayLocale = (typeof CALENDAR_DISPLAY_LOCALES)[number];

export type CalendarDisplayPrefs = {
  timeZone?: string;
  locale?: string;
  workdayStartHour?: number;
  workdayEndHour?: number;
};

export type CalendarVisibleHours = {
  visibleHours?: number;
  visibleHoursStart?: number;
};

const DISPLAY_LOCALES = new Set<string>(CALENDAR_DISPLAY_LOCALES);

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isHour(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isStoredTimeZone(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStoredLocale(value: unknown): value is CalendarDisplayLocale {
  return typeof value === "string" && DISPLAY_LOCALES.has(value);
}

/** Parse stored JSON. Invalid or empty payloads return {}. */
export function parseCalendarDisplayPrefs(raw: string | null): CalendarDisplayPrefs {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const prefs: CalendarDisplayPrefs = {};
    if (isStoredTimeZone(record.timeZone)) prefs.timeZone = record.timeZone.trim();
    if (isStoredLocale(record.locale)) prefs.locale = record.locale;
    if (isHour(record.workdayStartHour, 0, 23)) prefs.workdayStartHour = record.workdayStartHour;
    if (isHour(record.workdayEndHour, 1, 24)) prefs.workdayEndHour = record.workdayEndHour;
    return prefs;
  } catch {
    return {};
  }
}

export function readCalendarDisplayPrefs(): CalendarDisplayPrefs {
  if (!hasWindowStorage()) return {};
  try {
    return parseCalendarDisplayPrefs(
      window.localStorage.getItem(CALENDAR_DISPLAY_PREFS_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

export function writeCalendarDisplayPrefs(prefs: CalendarDisplayPrefs): void {
  if (!hasWindowStorage()) return;
  try {
    window.localStorage.setItem(CALENDAR_DISPLAY_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

/**
 * Day/week timeline window. Unset, partial, or start ≥ end keeps a full 24h grid.
 * `workdayEndHour` is exclusive (9–17 → eight hours starting at 09:00).
 */
export function resolveCalendarVisibleHours(
  prefs: Pick<CalendarDisplayPrefs, "workdayStartHour" | "workdayEndHour">,
): CalendarVisibleHours {
  const start = prefs.workdayStartHour;
  const end = prefs.workdayEndHour;
  if (start == null || end == null) return {};
  if (!isHour(start, 0, 23) || !isHour(end, 1, 24) || start >= end) return {};
  return { visibleHours: end - start, visibleHoursStart: start };
}

export function calendarDisplayLocaleLabel(locale: string, displayLocale: string): string {
  try {
    const names = new Intl.DisplayNames([displayLocale], { type: "language" });
    const label = names.of(locale);
    if (label) return `${label} (${locale})`;
  } catch {
    // Fall through to the tag.
  }
  return locale;
}

export function calendarDisplayTimeZoneOptions(
  locale: string,
  currentTimeZone?: string | null,
): { value: string; label: string }[] {
  return commonTimeZoneOptions(locale, currentTimeZone);
}

export { COMMON_EVENT_TIME_ZONES, formatTimeZoneLabel };
export type { CommonEventTimeZone };
