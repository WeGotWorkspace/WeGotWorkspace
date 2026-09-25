import { useMemo } from "react";
import { Repeat } from "lucide-react";
import {
  patchCalendarEventForm,
  type CalendarEventFormValue,
  type RecurrenceEndsMode,
} from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  EDITABLE_RECURRENCE_PRESET_IDS,
  recurrencePresetOptionLabel,
  type EditableRecurrencePresetId,
  type RecurrencePresetId,
} from "@/calendar-core/src/calendar-recurrence-presets";
import type { ControlSize } from "@/ui/control-size";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { LocaleDatePicker } from "@/ui/locale-date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

type CalendarEventFormFieldChange = <K extends keyof CalendarEventFormValue>(
  key: K,
  value: CalendarEventFormValue[K],
) => void;

export type CalendarEventFormRecurrenceProps = {
  form: CalendarEventFormValue;
  labels: CalendarUILabels;
  locale: string;
  controlSize: ControlSize;
  disabled: boolean;
  /** Other fields go through Meet commit; preset changes use the raw form onChange. */
  onChange: (next: CalendarEventFormValue) => void;
  onFieldChange: CalendarEventFormFieldChange;
};

/** Repeat preset and series-end controls for the shared event form. */
export function CalendarEventFormRecurrence({
  form,
  labels,
  locale,
  controlSize,
  disabled,
  onChange,
  onFieldChange,
}: CalendarEventFormRecurrenceProps) {
  const recurrenceLocked = form.recurrencePreset === "custom";
  const showRecurrenceEnds = !recurrenceLocked && form.recurrencePreset !== "none";
  const recurrenceOptions = useMemo(() => {
    const ids: RecurrencePresetId[] = recurrenceLocked
      ? ["custom"]
      : EDITABLE_RECURRENCE_PRESET_IDS;
    return ids.map((id) => ({
      id,
      label: recurrencePresetOptionLabel(id, form.startDate, locale),
    }));
  }, [form.startDate, locale, recurrenceLocked]);

  const setRecurrencePreset = (preset: EditableRecurrencePresetId) => {
    onChange(
      patchCalendarEventForm(form, {
        recurrencePreset: preset,
        customRecurrenceRules: undefined,
      }),
    );
  };

  return (
    <FieldLabelRow
      className="calendar-event-dialog__field calendar-event-dialog__field--repeat"
      label={labels.eventRepeatLabel}
      labelMode="icon"
      icon={<Repeat className="size-3.5" aria-hidden />}
    >
      <div className="calendar-event-dialog__repeat-stack">
        <Select
          value={form.recurrencePreset}
          onValueChange={(value) => setRecurrencePreset(value as EditableRecurrencePresetId)}
          disabled={recurrenceLocked || disabled}
        >
          <SelectTrigger
            size={controlSize}
            className="calendar-event-dialog__repeat-trigger"
            aria-label={labels.eventRepeatLabel}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {recurrenceOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showRecurrenceEnds ? (
          <div className="calendar-event-dialog__recurrence-ends">
            <Select
              value={form.recurrenceEnds}
              onValueChange={(value) =>
                onFieldChange("recurrenceEnds", value as RecurrenceEndsMode)
              }
              disabled={disabled}
            >
              <SelectTrigger size={controlSize} aria-label={labels.eventRecurrenceEndsLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">{labels.eventRecurrenceEndsNever}</SelectItem>
                <SelectItem value="until">{labels.eventRecurrenceEndsOnDate}</SelectItem>
                <SelectItem value="count">{labels.eventRecurrenceEndsAfter}</SelectItem>
              </SelectContent>
            </Select>
            {form.recurrenceEnds === "until" ? (
              <div className="calendar-event-dialog__recurrence-ends-extra">
                <LocaleDatePicker
                  value={form.recurrenceUntilDate || form.startDate}
                  locale={locale}
                  size={controlSize}
                  label={labels.eventRecurrenceEndsOnDate}
                  onChange={(next) => onFieldChange("recurrenceUntilDate", next)}
                  disabled={disabled}
                />
              </div>
            ) : null}
            {form.recurrenceEnds === "count" ? (
              <div className="calendar-event-dialog__recurrence-ends-extra">
                <div className="calendar-event-dialog__recurrence-count">
                  <Input
                    type="number"
                    size={controlSize}
                    min={1}
                    step={1}
                    value={form.recurrenceCount}
                    aria-label={labels.eventRecurrenceEndsAfter}
                    disabled={disabled}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      onFieldChange("recurrenceCount", Number.isFinite(parsed) ? parsed : 0);
                    }}
                  />
                  <span className="calendar-event-dialog__recurrence-count-suffix">
                    {labels.eventRecurrenceEndsCountSuffix}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </FieldLabelRow>
  );
}
