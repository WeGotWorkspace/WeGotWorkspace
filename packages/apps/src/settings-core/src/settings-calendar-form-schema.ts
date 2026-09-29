import { z } from "zod";
import {
  CALENDAR_DISPLAY_BROWSER_LOCALE,
  CALENDAR_DISPLAY_DEVICE_ZONE,
  CALENDAR_DISPLAY_LOCALES,
  CALENDAR_DISPLAY_WEEK_START_LOCALE,
  CALENDAR_WEEKDAY_VALUES,
  type CalendarDisplayPrefs,
  type CalendarWeekday,
} from "@/lib/calendar-display-prefs";

const localeValues = [CALENDAR_DISPLAY_BROWSER_LOCALE, ...CALENDAR_DISPLAY_LOCALES] as [
  string,
  ...string[],
];

const weekStartValues = [
  CALENDAR_DISPLAY_WEEK_START_LOCALE,
  ...CALENDAR_WEEKDAY_VALUES.map(String),
] as [string, ...string[]];

export const settingsCalendarFormSchema = z.object({
  timeZone: z.string().trim().min(1),
  locale: z.enum(localeValues),
  weekStart: z.enum(weekStartValues),
});

export type SettingsCalendarFormValues = z.infer<typeof settingsCalendarFormSchema>;

export function calendarDisplayPrefsToForm(
  prefs: CalendarDisplayPrefs,
): SettingsCalendarFormValues {
  const locale = prefs.locale?.trim();
  return {
    timeZone: prefs.timeZone?.trim() || CALENDAR_DISPLAY_DEVICE_ZONE,
    locale:
      locale && (CALENDAR_DISPLAY_LOCALES as readonly string[]).includes(locale)
        ? (locale as SettingsCalendarFormValues["locale"])
        : CALENDAR_DISPLAY_BROWSER_LOCALE,
    weekStart:
      prefs.weekStart != null
        ? (String(prefs.weekStart) as SettingsCalendarFormValues["weekStart"])
        : CALENDAR_DISPLAY_WEEK_START_LOCALE,
  };
}

export function calendarDisplayFormToPrefs(
  values: SettingsCalendarFormValues,
): CalendarDisplayPrefs {
  const prefs: CalendarDisplayPrefs = {};
  if (values.timeZone !== CALENDAR_DISPLAY_DEVICE_ZONE) prefs.timeZone = values.timeZone;
  if (values.locale !== CALENDAR_DISPLAY_BROWSER_LOCALE) prefs.locale = values.locale;
  if (values.weekStart !== CALENDAR_DISPLAY_WEEK_START_LOCALE) {
    const weekStart = Number(values.weekStart);
    if ((CALENDAR_WEEKDAY_VALUES as readonly number[]).includes(weekStart)) {
      prefs.weekStart = weekStart as CalendarWeekday;
    }
  }
  return prefs;
}
