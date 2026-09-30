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
export const CALENDAR_DISPLAY_WEEK_START_LOCALE = "locale";

export const CALENDAR_WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 7] as const;
/** Monday and Sunday — the two first-day choices consumer calendars actually offer. */
export const CALENDAR_WEEK_START_CHOICES = [1, 7] as const;
/** Hour counts offered in Settings; stored 1–24 still apply if present. */
export const CALENDAR_VISIBLE_HOURS_CHOICES = [8, 10, 12, 16, 24] as const;
/** Day/week grid zoom when prefs omit `visibleHours`. */
export const CALENDAR_VISIBLE_HOURS_DEFAULT = 12;
export const CALENDAR_HOUR_VALUES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
] as const;

export type CalendarWeekday = (typeof CALENDAR_WEEKDAY_VALUES)[number];
export type CalendarVisibleHours = number;
export type CalendarHour = (typeof CALENDAR_HOUR_VALUES)[number];

export type CalendarDisplayPrefs = {
  timeZone?: string;
  /** ISO weekday 1–7 (Monday=1). Omitted = language default. */
  weekStart?: CalendarWeekday;
  /** Writable calendar id for incoming invites. Omitted = collection default. */
  inviteCalendarId?: string;
  /** Day/week grid zoom: how many hours fill the viewport (1–24). Omitted = 12. */
  visibleHours?: CalendarVisibleHours;
  /** First visible hour (0–23) when `visibleHours` is set and today is out of range. */
  visibleHoursStart?: CalendarHour;
};

/** Monday 2024-01-01 — ISO weekday 1. */
const WEEKDAY_LABEL_MONDAY = Temporal.PlainDate.from("2024-01-01");

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isStoredTimeZone(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isWeekStart(value: unknown): value is CalendarWeekday {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}

function isInviteCalendarId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isCalendarVisibleHours(value: unknown): value is CalendarVisibleHours {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 24;
}

export function isCalendarVisibleHoursStart(value: unknown): value is CalendarHour {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
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
    if (isWeekStart(record.weekStart)) prefs.weekStart = record.weekStart;
    if (isInviteCalendarId(record.inviteCalendarId)) {
      prefs.inviteCalendarId = record.inviteCalendarId.trim();
    }
    if (isCalendarVisibleHours(record.visibleHours)) prefs.visibleHours = record.visibleHours;
    if (isCalendarVisibleHoursStart(record.visibleHoursStart)) {
      prefs.visibleHoursStart = record.visibleHoursStart;
    }
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

/** Returns false when storage is missing or the write throws (quota / private mode). */
export function writeCalendarDisplayPrefs(prefs: CalendarDisplayPrefs): boolean {
  if (!hasWindowStorage()) return false;
  try {
    window.localStorage.setItem(CALENDAR_DISPLAY_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
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

export function calendarVisibleHoursLabel(hours: number): string {
  const count = Math.trunc(hours);
  return count === 1 ? "1 hour" : `${count} hours`;
}

/** Clock label for hour 0–23 in the display locale. */
export function calendarHourLabel(hour: number, locale: string): string {
  const hourOfDay = ((Math.trunc(hour) % 24) + 24) % 24;
  try {
    return new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1, hourOfDay)),
    );
  } catch {
    return `${hourOfDay}:00`;
  }
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

export function calendarDisplayTimeZoneOptions(
  locale: string,
  currentTimeZone?: string | null,
): { value: string; label: string }[] {
  return commonTimeZoneOptions(locale, currentTimeZone);
}

export { COMMON_EVENT_TIME_ZONES, formatTimeZoneLabel };
export type { CommonEventTimeZone };
