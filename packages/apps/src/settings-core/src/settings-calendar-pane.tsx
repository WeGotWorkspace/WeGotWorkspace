import { useMemo } from "react";
import { Temporal } from "@js-temporal/polyfill";
import {
  CALENDAR_DISPLAY_BROWSER_LOCALE,
  CALENDAR_DISPLAY_DEVICE_ZONE,
  CALENDAR_DISPLAY_LOCALES,
  CALENDAR_DISPLAY_WEEK_START_LOCALE,
  CALENDAR_WEEKDAY_VALUES,
  calendarDisplayLocaleLabel,
  calendarDisplayTimeZoneOptions,
  calendarWeekdayLabel,
  formatTimeZoneLabel,
  resolveCalendarWeekStart,
} from "@/lib/calendar-display-prefs";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import { settingsWorkspacePaneClasses } from "@/settings-core/src/settings-workspace.styles";
import { useSettingsCalendarForm } from "@/settings-core/src/use-settings-calendar-form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Form, FormField } from "@/ui/form";
import { FormSaveActionRow } from "@/ui/form-save-action-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

/**
 * Timezone, locale, and week start for Calendar. Device-local; not exported from index.
 */
export function SettingsCalendarPane() {
  const { form, saveDisplay } = useSettingsCalendarForm();
  const uiLocale = resolveLocale(undefined);
  const deviceZone = Temporal.Now.timeZoneId();
  const timeZoneWatch = form.watch("timeZone");
  const localeWatch = form.watch("locale");
  const resolvedFormLocale =
    localeWatch === CALENDAR_DISPLAY_BROWSER_LOCALE ? uiLocale : localeWatch;
  const localeDefaultWeekday = resolveCalendarWeekStart({}, resolvedFormLocale);
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
            <FieldLabelRow label="Locale">
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger aria-label="Locale">
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
                    Locale default ({calendarWeekdayLabel(localeDefaultWeekday, uiLocale)})
                  </SelectItem>
                  {CALENDAR_WEEKDAY_VALUES.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {calendarWeekdayLabel(day, uiLocale)}
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
    </Form>
  );
}
