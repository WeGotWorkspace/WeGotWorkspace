import { useMemo } from "react";
import { Temporal } from "@js-temporal/polyfill";
import {
  CALENDAR_DISPLAY_BROWSER_LOCALE,
  CALENDAR_DISPLAY_DEVICE_ZONE,
  CALENDAR_DISPLAY_LOCALES,
  CALENDAR_DISPLAY_WEEK_START_LOCALE,
  CALENDAR_WEEK_START_CHOICES,
  calendarDisplayLocaleLabel,
  calendarDisplayTimeZoneOptions,
  calendarWeekdayLabel,
  formatTimeZoneLabel,
  resolveCalendarWeekStart,
} from "@/lib/calendar-display-prefs";
import {
  CalendarEventCalendarPicker,
  defaultPickerCalendarId,
} from "@/lib/calendar-event-calendar-picker";
import { useCalendarPickerCollections } from "@/lib/calendar-picker-collections";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import { settingsWorkspacePaneClasses } from "@/settings-core/src/settings-workspace.styles";
import { useSettingsCalendarForm } from "@/settings-core/src/use-settings-calendar-form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Form, FormField } from "@/ui/form";
import { FormSaveActionRow } from "@/ui/form-save-action-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

/**
 * Timezone, language, week start, and invite calendar for Calendar. Device-local.
 */
export function SettingsCalendarPane() {
  const { form, saveDisplay } = useSettingsCalendarForm();
  const calendars = useCalendarPickerCollections();
  const uiLocale = resolveLocale(undefined);
  const deviceZone = Temporal.Now.timeZoneId();
  const timeZoneWatch = form.watch("timeZone");
  const localeWatch = form.watch("locale");
  const weekStartWatch = form.watch("weekStart");
  const resolvedFormLocale =
    localeWatch === CALENDAR_DISPLAY_BROWSER_LOCALE ? uiLocale : localeWatch;
  const localeDefaultWeekday = resolveCalendarWeekStart({}, resolvedFormLocale);
  const weekStartDays = useMemo(() => {
    const days = [...CALENDAR_WEEK_START_CHOICES];
    const current = Number(weekStartWatch);
    if (
      Number.isInteger(current) &&
      current >= 1 &&
      current <= 7 &&
      !days.includes(current as (typeof CALENDAR_WEEK_START_CHOICES)[number])
    ) {
      days.push(current as (typeof CALENDAR_WEEK_START_CHOICES)[number]);
    }
    return days;
  }, [weekStartWatch]);
  const timeZoneOptions = useMemo(
    () =>
      calendarDisplayTimeZoneOptions(
        uiLocale,
        timeZoneWatch === CALENDAR_DISPLAY_DEVICE_ZONE ? undefined : timeZoneWatch,
      ),
    [timeZoneWatch, uiLocale],
  );

  return (
    <Form {...form}>
      <div className={settingsWorkspacePaneClasses.stack}>
        <FormField
          control={form.control}
          name="timeZone"
          render={({ field }) => (
            <FieldLabelRow label="Timezone">
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger aria-label="Timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={CALENDAR_DISPLAY_DEVICE_ZONE}>
                    Device default ({formatTimeZoneLabel(deviceZone, uiLocale)})
                  </SelectItem>
                  {timeZoneOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabelRow>
          )}
        />
        <FormField
          control={form.control}
          name="locale"
          render={({ field }) => (
            <FieldLabelRow label="Language">
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger aria-label="Language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={CALENDAR_DISPLAY_BROWSER_LOCALE}>Browser default</SelectItem>
                  {CALENDAR_DISPLAY_LOCALES.map((locale) => (
                    <SelectItem key={locale} value={locale}>
                      {calendarDisplayLocaleLabel(locale, uiLocale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabelRow>
          )}
        />
        <FormField
          control={form.control}
          name="weekStart"
          render={({ field }) => (
            <FieldLabelRow label="Day starts on">
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger aria-label="Day starts on">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={CALENDAR_DISPLAY_WEEK_START_LOCALE}>
                    Language default ({calendarWeekdayLabel(localeDefaultWeekday, uiLocale)})
                  </SelectItem>
                  {weekStartDays.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {calendarWeekdayLabel(day, uiLocale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabelRow>
          )}
        />
        {calendars.length > 0 ? (
          <FormField
            control={form.control}
            name="inviteCalendarId"
            render={({ field }) => (
              <FieldLabelRow label="Incoming invites">
                <CalendarEventCalendarPicker
                  calendars={calendars}
                  calendarId={defaultPickerCalendarId(calendars, field.value || undefined)}
                  label="Incoming invites"
                  onCalendarIdChange={(calendarId) => field.onChange(calendarId)}
                />
              </FieldLabelRow>
            )}
          />
        ) : null}
        <FormSaveActionRow
          className={settingsWorkspacePaneClasses.saveActionRow}
          label="Save"
          disabled={!form.formState.isDirty}
          onSave={saveDisplay}
        />
      </div>
    </Form>
  );
}
