import { z } from "zod";
import {
  CALENDAR_DISPLAY_DEVICE_ZONE,
  CALENDAR_DISPLAY_WEEK_START_LOCALE,
  CALENDAR_WEEKDAY_VALUES,
  type CalendarDisplayPrefs,
  type CalendarWeekday,
} from "@/lib/calendar-display-prefs";

const weekStartValues = [
  CALENDAR_DISPLAY_WEEK_START_LOCALE,
  ...CALENDAR_WEEKDAY_VALUES.map(String),
] as [string, ...string[]];

export const settingsCalendarFormSchema = z.object({
  timeZone: z.string().trim().min(1),
  weekStart: z.enum(weekStartValues),
  inviteCalendarId: z.string(),
});

export type SettingsCalendarFormValues = z.infer<typeof settingsCalendarFormSchema>;

export function calendarDisplayPrefsToForm(
  prefs: CalendarDisplayPrefs,
): SettingsCalendarFormValues {
  return {
    timeZone: prefs.timeZone?.trim() || CALENDAR_DISPLAY_DEVICE_ZONE,
    weekStart:
      prefs.weekStart != null
        ? (String(prefs.weekStart) as SettingsCalendarFormValues["weekStart"])
        : CALENDAR_DISPLAY_WEEK_START_LOCALE,
    inviteCalendarId: prefs.inviteCalendarId?.trim() ?? "",
  };
}

export function calendarDisplayFormToPrefs(
  values: SettingsCalendarFormValues,
): CalendarDisplayPrefs {
  const prefs: CalendarDisplayPrefs = {};
  if (values.timeZone !== CALENDAR_DISPLAY_DEVICE_ZONE) prefs.timeZone = values.timeZone;
  if (values.weekStart !== CALENDAR_DISPLAY_WEEK_START_LOCALE) {
    const weekStart = Number(values.weekStart);
    if ((CALENDAR_WEEKDAY_VALUES as readonly number[]).includes(weekStart)) {
      prefs.weekStart = weekStart as CalendarWeekday;
    }
  }
  const inviteCalendarId = values.inviteCalendarId.trim();
  if (inviteCalendarId) prefs.inviteCalendarId = inviteCalendarId;
  return prefs;
}
