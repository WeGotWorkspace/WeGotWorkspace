import { useEffect, useMemo } from "react";
import { Temporal } from "@js-temporal/polyfill";
import {
  CALENDAR_DISPLAY_DEVICE_ZONE,
  CALENDAR_DISPLAY_WEEK_START_LOCALE,
  CALENDAR_VISIBLE_HOURS_CHOICES,
  CALENDAR_WEEK_START_CHOICES,
  calendarDisplayTimeZoneOptions,
  calendarVisibleHoursLabel,
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
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { useSettingsCalendarForm } from "@/settings-core/src/use-settings-calendar-form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Form, FormField } from "@/ui/form";
import { FormSaveActionRow } from "@/ui/form-save-action-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

/**
 * Default calendar, timezone, week start, and visible hours for Calendar. Device-local.
 * Language stays off this pane until workspace-wide i18n exists.
 */
export function SettingsCalendarPane() {
  const { form, saveDisplay } = useSettingsCalendarForm();
  const { collections: calendars, loaded: calendarsLoaded } = useCalendarPickerCollections();
  const uiLocale = resolveLocale(undefined);
  const deviceZone = Temporal.Now.timeZoneId();
  const timeZoneWatch = form.watch("timeZone");
  const weekStartWatch = form.watch("weekStart");
  const visibleHoursWatch = form.watch("visibleHours");
  const inviteWatch = form.watch("inviteCalendarId");
  useEffect(() => {
    if (!calendarsLoaded || calendars.length === 0) return;
    const resolved = defaultPickerCalendarId(calendars, inviteWatch || undefined);
    if (inviteWatch && resolved && resolved !== inviteWatch) {
      form.setValue("inviteCalendarId", resolved, { shouldDirty: true });
    }
  }, [calendars, calendarsLoaded, form, inviteWatch]);
  const localeDefaultWeekday = resolveCalendarWeekStart({}, uiLocale);
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
  const visibleHoursDays = useMemo(() => {
    const hours = [...CALENDAR_VISIBLE_HOURS_CHOICES];
    const current = Number(visibleHoursWatch);
    if (
      Number.isInteger(current) &&
      current >= 1 &&
      current <= 24 &&
      !hours.includes(current as (typeof CALENDAR_VISIBLE_HOURS_CHOICES)[number])
    ) {
      hours.push(current as (typeof CALENDAR_VISIBLE_HOURS_CHOICES)[number]);
      hours.sort((left, right) => left - right);
    }
    return hours;
  }, [visibleHoursWatch]);

  return (
    <Form {...form}>
      <SettingsPaneCard>
        <div className={settingsWorkspacePaneClasses.stack}>
          {calendars.length > 0 ? (
            <FormField
              control={form.control}
              name="inviteCalendarId"
              render={({ field }) => (
                <FieldLabelRow label="Default calendar">
                  <CalendarEventCalendarPicker
                    calendars={calendars}
                    calendarId={defaultPickerCalendarId(calendars, field.value || undefined)}
                    label="Default calendar"
                    showName
                    onCalendarIdChange={(calendarId) => field.onChange(calendarId)}
                  />
                </FieldLabelRow>
              )}
            />
          ) : null}
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
            name="weekStart"
            render={({ field }) => (
              <FieldLabelRow label="Week starts on">
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Week starts on">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={CALENDAR_DISPLAY_WEEK_START_LOCALE}>
                      Browser default ({calendarWeekdayLabel(localeDefaultWeekday, uiLocale)})
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
          <FormField
            control={form.control}
            name="visibleHours"
            render={({ field }) => (
              <FieldLabelRow label="Visible hours">
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Visible hours">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {visibleHoursDays.map((hours) => (
                      <SelectItem key={hours} value={String(hours)}>
                        {calendarVisibleHoursLabel(hours)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldLabelRow>
            )}
          />
          <FormSaveActionRow
            className={settingsWorkspacePaneClasses.saveActionRow}
            label="Save"
            disabled={!form.formState.isDirty}
            onSave={saveDisplay}
          />
        </div>
      </SettingsPaneCard>
    </Form>
  );
}
