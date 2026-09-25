import { useMemo } from "react";
import { CalendarDays, Globe, Sun } from "lucide-react";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  eventTimeZoneFromSelectValue,
  eventTimeZoneOptions,
  eventTimeZoneSelectValue,
} from "@/calendar-core/src/calendar-timezones";
import type { ControlSize } from "@/ui/control-size";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { LocaleDatePicker } from "@/ui/locale-date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";

export type CalendarEventFormFieldChange = <K extends keyof CalendarEventFormValue>(
  key: K,
  value: CalendarEventFormValue[K],
) => void;

export type CalendarEventFormWhenProps = {
  form: CalendarEventFormValue;
  labels: CalendarUILabels;
  locale: string;
  controlSize: ControlSize;
  disabled: boolean;
  onFieldChange: CalendarEventFormFieldChange;
};

/** Start, end, all-day, and time zone rows for the shared event form. */
export function CalendarEventFormWhen({
  form,
  labels,
  locale,
  controlSize,
  disabled,
  onFieldChange,
}: CalendarEventFormWhenProps) {
  const timeZoneOptions = useMemo(
    () => eventTimeZoneOptions(locale, labels.eventTimeZoneLocalLabel, form.timeZone),
    [form.timeZone, labels.eventTimeZoneLocalLabel, locale],
  );

  return (
    <div className="calendar-event-dialog__field-group calendar-event-dialog__field-group--when">
      <FieldLabelRow
        className="calendar-event-dialog__field calendar-event-dialog__field--starts"
        label={labels.eventStartLabel}
        labelMode="icon"
        icon={<CalendarDays className="size-3.5" aria-hidden />}
      >
        <div className="calendar-event-dialog__datetime">
          <LocaleDatePicker
            value={form.startDate}
            locale={locale}
            size={controlSize}
            label={labels.eventStartLabel}
            onChange={(next) => onFieldChange("startDate", next)}
            disabled={disabled}
          />
          <div className="calendar-event-dialog__time-slot" aria-hidden={form.allDay || undefined}>
            {!form.allDay ? (
              <Input
                type="time"
                size={controlSize}
                lang={locale}
                value={form.startTime}
                aria-label={`${labels.eventStartLabel} time`}
                disabled={disabled}
                onChange={(event) => onFieldChange("startTime", event.target.value)}
              />
            ) : null}
          </div>
        </div>
      </FieldLabelRow>
      <FieldLabelRow
        className="calendar-event-dialog__field calendar-event-dialog__field--ends"
        label={labels.eventEndLabel}
        labelMode="icon"
        icon={<CalendarDays className="size-3.5" aria-hidden />}
      >
        <div className="calendar-event-dialog__datetime">
          <LocaleDatePicker
            value={form.endDate}
            locale={locale}
            size={controlSize}
            label={labels.eventEndLabel}
            onChange={(next) => onFieldChange("endDate", next)}
            disabled={disabled}
          />
          <div className="calendar-event-dialog__time-slot" aria-hidden={form.allDay || undefined}>
            {!form.allDay ? (
              <Input
                type="time"
                size={controlSize}
                lang={locale}
                value={form.endTime}
                aria-label={`${labels.eventEndLabel} time`}
                disabled={disabled}
                onChange={(event) => onFieldChange("endTime", event.target.value)}
              />
            ) : null}
          </div>
        </div>
      </FieldLabelRow>
      <div className="calendar-event-dialog__when-meta">
        <FieldLabelRow
          className="calendar-event-dialog__field calendar-event-dialog__field--all-day"
          label={labels.eventAllDayLabel}
          labelMode="icon"
          icon={<Sun className="size-3.5" aria-hidden />}
        >
          <div className="calendar-event-dialog__all-day">
            <Switch
              checked={form.allDay}
              onCheckedChange={(checked) => onFieldChange("allDay", checked === true)}
              aria-label={labels.eventAllDayLabel}
              disabled={disabled}
            />
            <span className="calendar-event-dialog__all-day-caption" aria-hidden>
              {labels.eventAllDayLabel}
            </span>
          </div>
        </FieldLabelRow>
        {!form.allDay ? (
          <FieldLabelRow
            className="calendar-event-dialog__field calendar-event-dialog__field--timezone"
            label={labels.eventTimeZoneLabel}
            labelMode="icon"
            icon={<Globe className="size-3.5" aria-hidden />}
          >
            <Select
              value={eventTimeZoneSelectValue(form.timeZone)}
              onValueChange={(value) =>
                onFieldChange("timeZone", eventTimeZoneFromSelectValue(value))
              }
              disabled={disabled}
            >
              <SelectTrigger
                size={controlSize}
                className="calendar-event-dialog__timezone-trigger"
                aria-label={labels.eventTimeZoneLabel}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timeZoneOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLabelRow>
        ) : null}
      </div>
    </div>
  );
}
