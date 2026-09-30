import { z } from "zod";
import {
  CALENDAR_DISPLAY_DEVICE_ZONE,
  CALENDAR_DISPLAY_VISIBLE_HOURS_DEFAULT,
  CALENDAR_DISPLAY_WEEK_START_LOCALE,
  CALENDAR_HOUR_VALUES,
  CALENDAR_VISIBLE_HOURS_START_DEFAULT,
  CALENDAR_WEEKDAY_VALUES,
  isCalendarVisibleHours,
  isCalendarVisibleHoursStart,
  type CalendarDisplayPrefs,
  type CalendarWeekday,
} from "@/lib/calendar-display-prefs";

const weekStartValues = [
  CALENDAR_DISPLAY_WEEK_START_LOCALE,
  ...CALENDAR_WEEKDAY_VALUES.map(String),
] as [string, ...string[]];

const visibleHoursValues = [
  CALENDAR_DISPLAY_VISIBLE_HOURS_DEFAULT,
  ...Array.from({ length: 24 }, (_, index) => String(index + 1)),
] as [string, ...string[]];

const visibleHoursStartValues = CALENDAR_HOUR_VALUES.map(String) as [string, ...string[]];

export const settingsCalendarFormSchema = z.object({
  timeZone: z.string().trim().min(1),
  weekStart: z.enum(weekStartValues),
  inviteCalendarId: z.string(),
  visibleHours: z.enum(visibleHoursValues),
  visibleHoursStart: z.enum(visibleHoursStartValues),
});

export type SettingsCalendarFormValues = z.infer<typeof settingsCalendarFormSchema>;

export function calendarVisibleHoursStartVisible(visibleHours: string): boolean {
  if (visibleHours === CALENDAR_DISPLAY_VISIBLE_HOURS_DEFAULT) return false;
  const hours = Number(visibleHours);
  return Number.isInteger(hours) && hours >= 1 && hours < 24;
}

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
    visibleHours:
      prefs.visibleHours != null
        ? (String(prefs.visibleHours) as SettingsCalendarFormValues["visibleHours"])
        : CALENDAR_DISPLAY_VISIBLE_HOURS_DEFAULT,
    visibleHoursStart: String(
      prefs.visibleHoursStart ?? CALENDAR_VISIBLE_HOURS_START_DEFAULT,
    ) as SettingsCalendarFormValues["visibleHoursStart"],
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
  if (values.visibleHours !== CALENDAR_DISPLAY_VISIBLE_HOURS_DEFAULT) {
    const visibleHours = Number(values.visibleHours);
    if (isCalendarVisibleHours(visibleHours)) {
      prefs.visibleHours = visibleHours;
      if (visibleHours < 24) {
        const start = Number(values.visibleHoursStart);
        const clamped = Math.max(0, Math.min(24 - visibleHours, start));
        if (isCalendarVisibleHoursStart(clamped)) prefs.visibleHoursStart = clamped;
      }
    }
  }
  return prefs;
}

export function calendarVisibleHoursStartOptions(
  visibleHours: string,
  currentStart: string,
): number[] {
  const hours = Number(visibleHours);
  const maxStart =
    Number.isInteger(hours) && hours >= 1 && hours <= 24 ? Math.max(0, 24 - hours) : 23;
  const options: number[] = CALENDAR_HOUR_VALUES.filter((hour) => hour <= maxStart);
  const current = Number(currentStart);
  if (Number.isInteger(current) && current >= 0 && current <= 23 && !options.includes(current)) {
    options.push(current);
    options.sort((left, right) => left - right);
  }
  return options;
}
