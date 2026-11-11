import { useId, useMemo, useState, type ComponentProps } from "react";
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
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
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

/**
 * A time field that applies what you type when you leave it (or press Enter). The form
 * keeps the end after the start, so applying every keystroke would fight the typing:
 * "16:45" passes through "01:45" and the end would be pushed back each time.
 */
function EventTimeInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange" | "onBlur"> & {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value && draft !== "") onCommit(draft);
    setDraft(null);
  };
  return (
    <Input
      {...props}
      type="time"
      variant="ghost"
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

/** Start, end, all-day, and time zone rows for the shared event form. */
export function CalendarEventFormWhen({
  form,
  labels,
  locale,
  controlSize,
  disabled,
  onFieldChange,
}: CalendarEventFormWhenProps) {
  const allDayId = useId();
  const timeZoneId = useId();
  const timeZoneOptions = useMemo(
    () => eventTimeZoneOptions(locale, labels.eventTimeZoneLocalLabel, form.timeZone),
    [form.timeZone, labels.eventTimeZoneLocalLabel, locale],
  );

  return (
    <div className="calendar-event-dialog__field-group calendar-event-dialog__field-group--when">
      <FieldLabelRow
        className="calendar-event-dialog__field calendar-event-dialog__field--starts"
        layout="inline"
        label={labels.eventStartLabel}
      >
        <div className="calendar-event-dialog__datetime">
          <LocaleDatePicker
            variant="ghost"
            value={form.startDate}
            locale={locale}
            size={controlSize}
            label={labels.eventStartLabel}
            onChange={(next) => onFieldChange("startDate", next)}
            disabled={disabled}
          />
          <div className="calendar-event-dialog__time-slot" aria-hidden={form.allDay || undefined}>
            {!form.allDay ? (
              <EventTimeInput
                size={controlSize}
                lang={locale}
                value={form.startTime}
                aria-label={`${labels.eventStartLabel} time`}
                disabled={disabled}
                onCommit={(next) => onFieldChange("startTime", next)}
              />
            ) : null}
          </div>
        </div>
      </FieldLabelRow>
      <FieldLabelRow
        className="calendar-event-dialog__field calendar-event-dialog__field--ends"
        layout="inline"
        label={labels.eventEndLabel}
      >
        <div className="calendar-event-dialog__datetime">
          <LocaleDatePicker
            variant="ghost"
            value={form.endDate}
            locale={locale}
            size={controlSize}
            label={labels.eventEndLabel}
            onChange={(next) => onFieldChange("endDate", next)}
            disabled={disabled}
          />
          <div className="calendar-event-dialog__time-slot" aria-hidden={form.allDay || undefined}>
            {!form.allDay ? (
              <EventTimeInput
                size={controlSize}
                lang={locale}
                value={form.endTime}
                aria-label={`${labels.eventEndLabel} time`}
                disabled={disabled}
                onCommit={(next) => onFieldChange("endTime", next)}
              />
            ) : null}
          </div>
        </div>
      </FieldLabelRow>
      <FieldLabelRow
        className="calendar-event-dialog__field calendar-event-dialog__field--all-day"
        layout="inline"
        label={labels.eventAllDayLabel}
        htmlFor={allDayId}
      >
        <Switch
          id={allDayId}
          checked={form.allDay}
          onCheckedChange={(checked) => onFieldChange("allDay", checked === true)}
          disabled={disabled}
        />
      </FieldLabelRow>
      {!form.allDay ? (
        <FieldLabelRow
          className="calendar-event-dialog__field calendar-event-dialog__field--timezone"
          layout="inline"
          label={labels.eventTimeZoneLabel}
          htmlFor={timeZoneId}
        >
          <Select
            value={eventTimeZoneSelectValue(form.timeZone)}
            onValueChange={(value) =>
              onFieldChange("timeZone", eventTimeZoneFromSelectValue(value))
            }
            disabled={disabled}
          >
            <CollectionGhostSelectTrigger id={timeZoneId} label={<SelectValue />} />
            <SelectContent align="end" className="max-h-72">
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
  );
}
