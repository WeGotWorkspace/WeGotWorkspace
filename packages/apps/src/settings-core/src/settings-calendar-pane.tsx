import { useMemo } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Card } from "@/card/src/card";
import {
  CALENDAR_DISPLAY_BROWSER_LOCALE,
  CALENDAR_DISPLAY_DEVICE_ZONE,
  CALENDAR_DISPLAY_LOCALES,
  CALENDAR_DISPLAY_WORKDAY_UNSET,
  calendarDisplayLocaleLabel,
  calendarDisplayTimeZoneOptions,
  formatTimeZoneLabel,
} from "@/lib/calendar-display-prefs";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import { settingsWorkspacePaneClasses } from "@/settings-core/src/settings-workspace.styles";
import { useSettingsCalendarForm } from "@/settings-core/src/use-settings-calendar-form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Form, FormField, FormItem, FormMessage } from "@/ui/form";
import { FormSaveActionRow } from "@/ui/form-save-action-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

const WORKDAY_START_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WORKDAY_END_HOURS = Array.from({ length: 24 }, (_, hour) => hour + 1);

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * Timezone, working hours, and locale for Calendar. Device-local; not exported from index.
 */
export function SettingsCalendarPane() {
  const { form, saveDisplay } = useSettingsCalendarForm();
  const uiLocale = resolveLocale(undefined);
  const deviceZone = Temporal.Now.timeZoneId();
  const timeZoneWatch = form.watch("timeZone");
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
      <Card title="Display">
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
        <div className={settingsWorkspacePaneClasses.grid2}>
          <FormField
            control={form.control}
            name="workdayStartHour"
            render={({ field }) => (
              <FieldLabelRow label="Working hours start">
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Working hours start">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={CALENDAR_DISPLAY_WORKDAY_UNSET}>
                      Unset (24-hour grid)
                    </SelectItem>
                    {WORKDAY_START_HOURS.map((hour) => (
                      <SelectItem key={hour} value={String(hour)}>
                        {formatHourLabel(hour)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldLabelRow>
            )}
          />
          <FormField
            control={form.control}
            name="workdayEndHour"
            render={({ field }) => (
              <FormItem>
                <FieldLabelRow label="Working hours end">
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger aria-label="Working hours end">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value={CALENDAR_DISPLAY_WORKDAY_UNSET}>
                        Unset (24-hour grid)
                      </SelectItem>
                      {WORKDAY_END_HOURS.map((hour) => (
                        <SelectItem key={hour} value={String(hour)}>
                          {formatHourLabel(hour)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldLabelRow>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormSaveActionRow
          className={settingsWorkspacePaneClasses.saveActionRow}
          label="Save changes"
          disabled={!form.formState.isDirty}
          onSave={saveDisplay}
        />
      </Card>
    </Form>
  );
}
