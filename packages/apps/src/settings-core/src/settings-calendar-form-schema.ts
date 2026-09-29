import { z } from "zod";
import {
  CALENDAR_DISPLAY_BROWSER_LOCALE,
  CALENDAR_DISPLAY_DEVICE_ZONE,
  CALENDAR_DISPLAY_LOCALES,
  CALENDAR_DISPLAY_WORKDAY_UNSET,
  type CalendarDisplayPrefs,
} from "@/lib/calendar-display-prefs";

const localeValues = [CALENDAR_DISPLAY_BROWSER_LOCALE, ...CALENDAR_DISPLAY_LOCALES] as [
  string,
  ...string[],
];

export const settingsCalendarFormSchema = z
  .object({
    timeZone: z.string().trim().min(1),
    locale: z.enum(localeValues),
    workdayStartHour: z.string().min(1),
    workdayEndHour: z.string().min(1),
  })
  .superRefine((values, ctx) => {
    const startUnset = values.workdayStartHour === CALENDAR_DISPLAY_WORKDAY_UNSET;
    const endUnset = values.workdayEndHour === CALENDAR_DISPLAY_WORKDAY_UNSET;
    if (startUnset && endUnset) return;
    if (startUnset || endUnset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Set both working hours or leave both unset",
        path: ["workdayEndHour"],
      });
      return;
    }
    const start = Number(values.workdayStartHour);
    const end = Number(values.workdayEndHour);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End must be after start",
        path: ["workdayEndHour"],
      });
    }
  });

export type SettingsCalendarFormValues = z.infer<typeof settingsCalendarFormSchema>;

function hourOrUnset(value: number | undefined): string {
  return value == null ? CALENDAR_DISPLAY_WORKDAY_UNSET : String(value);
}

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
    workdayStartHour: hourOrUnset(prefs.workdayStartHour),
    workdayEndHour: hourOrUnset(prefs.workdayEndHour),
  };
}

export function calendarDisplayFormToPrefs(
  values: SettingsCalendarFormValues,
): CalendarDisplayPrefs {
  const prefs: CalendarDisplayPrefs = {};
  if (values.timeZone !== CALENDAR_DISPLAY_DEVICE_ZONE) prefs.timeZone = values.timeZone;
  if (values.locale !== CALENDAR_DISPLAY_BROWSER_LOCALE) prefs.locale = values.locale;
  if (
    values.workdayStartHour !== CALENDAR_DISPLAY_WORKDAY_UNSET &&
    values.workdayEndHour !== CALENDAR_DISPLAY_WORKDAY_UNSET
  ) {
    const start = Number(values.workdayStartHour);
    const end = Number(values.workdayEndHour);
    if (Number.isInteger(start) && Number.isInteger(end) && start < end) {
      prefs.workdayStartHour = start;
      prefs.workdayEndHour = end;
    }
  }
  return prefs;
}
