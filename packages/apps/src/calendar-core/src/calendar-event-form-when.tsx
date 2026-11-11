import { CalendarDays, Sun } from "lucide-react";
import { useId, useMemo, useState, type ComponentProps } from "react";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  eventTimeZoneFromSelectValue,
  eventTimeZoneOptions,
  eventTimeZoneSelectValue,
} from "@/calendar-core/src/calendar-timezones";
import type { ControlSize } from "@/ui/control-size";
import { FieldLabelRow, useFieldLabelMode } from "@/ui/field-label-row";
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

  // Icon rows (the popover): the time zone sits in the All day row, after the switch.
  const iconRows = useFieldLabelMode() === "icon";
  const allDaySwitch = (
    <Switch
      id={allDayId}
      checked={form.allDay}
      onCheckedChange={(checked) => onFieldChange("allDay", checked === true)}
      disabled={disabled}
    />
  );
  const timeZoneSelect = (
    <Select
      value={eventTimeZoneSelectValue(form.timeZone)}
      onValueChange={(value) => onFieldChange("timeZone", eventTimeZoneFromSelectValue(value))}
      disabled={disabled}
    >
      <CollectionGhostSelectTrigger
        id={timeZoneId}
        aria-label={iconRows ? labels.eventTimeZoneLabel : undefined}
        label={<SelectValue />}
      />
      <SelectContent align={iconRows ? "start" : "end"} className="max-h-72">
        {timeZoneOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  /** The Starts or Ends row: a date, then the time unless the event is all day. */
  const dateTimeRow = (edge: "start" | "end") => {
    const label = edge === "start" ? labels.eventStartLabel : labels.eventEndLabel;
    const dateField = edge === "start" ? "startDate" : "endDate";
    const timeField = edge === "start" ? "startTime" : "endTime";
    return (
      <FieldLabelRow
        className={`calendar-event-dialog__field calendar-event-dialog__field--${edge}s`}
        layout="inline"
        label={label}
        labelIcon={<CalendarDays aria-hidden />}
      >
        <div className="calendar-event-dialog__datetime">
          <LocaleDatePicker
            variant="ghost"
            value={form[dateField]}
            locale={locale}
            size={controlSize}
            label={label}
            onChange={(next) => onFieldChange(dateField, next)}
            disabled={disabled}
          />
          <div className="calendar-event-dialog__time-slot" aria-hidden={form.allDay || undefined}>
            {!form.allDay ? (
              <EventTimeInput
                size={controlSize}
                lang={locale}
                value={form[timeField]}
                aria-label={`${label} time`}
                disabled={disabled}
                onCommit={(next) => onFieldChange(timeField, next)}
              />
            ) : null}
          </div>
        </div>
      </FieldLabelRow>
    );
  };

  return (
    <div className="calendar-event-dialog__field-group calendar-event-dialog__field-group--when">
      {dateTimeRow("start")}
      {dateTimeRow("end")}
      <FieldLabelRow
        className="calendar-event-dialog__field calendar-event-dialog__field--all-day"
        layout="inline"
        label={labels.eventAllDayLabel}
        labelIcon={<Sun aria-hidden />}
        htmlFor={allDayId}
      >
        {iconRows ? (
          <div className="calendar-event-dialog__all-day">
            {allDaySwitch}
            {form.allDay ? null : timeZoneSelect}
          </div>
        ) : (
          allDaySwitch
        )}
      </FieldLabelRow>
      {!form.allDay && !iconRows ? (
        <FieldLabelRow
          className="calendar-event-dialog__field calendar-event-dialog__field--timezone"
          layout="inline"
          label={labels.eventTimeZoneLabel}
          htmlFor={timeZoneId}
        >
          {timeZoneSelect}
        </FieldLabelRow>
      ) : null}
    </div>
  );
}
