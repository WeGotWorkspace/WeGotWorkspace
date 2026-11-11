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
import { defaultPickerCalendarId } from "@/lib/calendar-event-calendar-picker";
import { useCalendarPickerCollections } from "@/lib/calendar-picker-collections";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import { useSettingsCalendarForm } from "@/settings-core/src/use-settings-calendar-form";
import { SettingsPrefsFormPane } from "@/settings-core/src/settings-prefs-form-pane";
import { SettingsCollectionSelect } from "@/settings-core/src/settings-collection-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormField } from "@/ui/form";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";

/**
 * Default calendar, timezone, week start, and visible hours for Calendar. Device-local.
 * Language stays off this pane until workspace-wide i18n exists.
 */
export function SettingsCalendarPane() {
  const controller = useSettingsCalendarForm();
  const { form } = controller;
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
    <SettingsPrefsFormPane controller={controller}>
      {calendars.length > 0 ? (
        <FormField
          control={form.control}
          name="inviteCalendarId"
          render={({ field }) => (
            <FieldLabelRow
              layout="inline"
              label="Default calendar"
              description="Where new events are saved"
            >
              <SettingsCollectionSelect
                collections={calendars}
                value={field.value}
                label="Default calendar"
                onValueChange={field.onChange}
              />
            </FieldLabelRow>
          )}
        />
      ) : null}
      <FormField
        control={form.control}
        name="timeZone"
        render={({ field }) => (
          <FieldLabelRow
            layout="inline"
            label="Timezone"
            description="Calendar shows times in this zone"
          >
            <Select value={field.value} onValueChange={field.onChange}>
              <CollectionGhostSelectTrigger aria-label="Timezone" label={<SelectValue />} />
              <SelectContent align="end" className="max-h-72">
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
          <FieldLabelRow
            layout="inline"
            label="Week starts on"
            description="First day of the week and month views"
          >
            <Select value={field.value} onValueChange={field.onChange}>
              <CollectionGhostSelectTrigger aria-label="Week starts on" label={<SelectValue />} />
              <SelectContent align="end" className="max-h-72">
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
          <FieldLabelRow
            layout="inline"
            label="Visible hours"
            description="Hours that fit on screen in day and week views"
          >
            <Select value={field.value} onValueChange={field.onChange}>
              <CollectionGhostSelectTrigger aria-label="Visible hours" label={<SelectValue />} />
              <SelectContent align="end" className="max-h-72">
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
    </SettingsPrefsFormPane>
  );
}
