import { Temporal } from "@js-temporal/polyfill";
import {
  COMMON_EVENT_TIME_ZONES,
  commonTimeZoneOptions,
  formatTimeZoneLabel,
  type CommonEventTimeZone,
} from "@/lib/calendar-time-zones";
import { getLocaleWeekInfo } from "@/lib/calendar-elements/utils/Locale";

export const CALENDAR_DISPLAY_PREFS_STORAGE_KEY = "wgw.ui.calendar.displayPrefs";

export const CALENDAR_DISPLAY_DEVICE_ZONE = "device";
export const CALENDAR_DISPLAY_BROWSER_LOCALE = "browser";
export const CALENDAR_DISPLAY_WEEK_START_LOCALE = "locale";

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

export const CALENDAR_WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 7] as const;

export type CalendarDisplayLocale = (typeof CALENDAR_DISPLAY_LOCALES)[number];
export type CalendarWeekday = (typeof CALENDAR_WEEKDAY_VALUES)[number];

export type CalendarDisplayPrefs = {
  timeZone?: string;
  locale?: string;
  /** ISO weekday 1–7 (Monday=1). Omitted = locale default. */
  weekStart?: CalendarWeekday;
};

const DISPLAY_LOCALES = new Set<string>(CALENDAR_DISPLAY_LOCALES);
/** Monday 2024-01-01 — ISO weekday 1. */
const WEEKDAY_LABEL_MONDAY = Temporal.PlainDate.from("2024-01-01");

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isStoredTimeZone(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStoredLocale(value: unknown): value is CalendarDisplayLocale {
  return typeof value === "string" && DISPLAY_LOCALES.has(value);
}

function isWeekStart(value: unknown): value is CalendarWeekday {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
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
    if (isWeekStart(record.weekStart)) prefs.weekStart = record.weekStart;
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

/** ISO weekday for the week grid. Unset follows the locale first day (Monday when unknown). */
export function resolveCalendarWeekStart(
  prefs: Pick<CalendarDisplayPrefs, "weekStart">,
  locale: string,
): CalendarWeekday {
  if (isWeekStart(prefs.weekStart)) return prefs.weekStart;
  return getLocaleWeekInfo(locale).firstDay ?? 1;
}

/** Long weekday name for ISO day 1–7 (Monday–Sunday). */
export function calendarWeekdayLabel(isoWeekday: number, locale: string): string {
  const day = ((Math.trunc(isoWeekday) - 1 + 7) % 7) + 1;
  const date = WEEKDAY_LABEL_MONDAY.add({ days: day - 1 });
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(date.year, date.month - 1, date.day)),
    );
  } catch {
    return date.toLocaleString("en-US", { weekday: "long" });
  }
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
