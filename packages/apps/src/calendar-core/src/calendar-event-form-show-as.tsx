import { useId } from "react";
import { Callout } from "@/callout/src/callout";
import { type CalendarFreeBusyStatus } from "@/calendar-core/src/calendar-alerts";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";

type CalendarEventFormFieldChange = <K extends keyof CalendarEventFormValue>(
  key: K,
  value: CalendarEventFormValue[K],
) => void;

export type CalendarEventFormShowAsProps = {
  form: CalendarEventFormValue;
  labels: CalendarUILabels;
  disabled: boolean;
  /** Someone else's event: no time-off hint, the viewer cannot change it. */
  readOnly?: boolean;
  onFieldChange: CalendarEventFormFieldChange;
};

/** Busy/free availability field for the shared event form. All-day Free gets a time-off hint. */
export function CalendarEventFormShowAs({
  form,
  labels,
  disabled,
  readOnly = false,
  onFieldChange,
}: CalendarEventFormShowAsProps) {
  const showAsId = useId();
  const showTimeOffHint = !readOnly && form.allDay && form.freeBusyStatus === "free";
  return (
    <FieldLabelRow
      className="calendar-event-dialog__field calendar-event-dialog__field--availability"
      layout="inline"
      label={labels.eventShowAs}
      htmlFor={showAsId}
      below={
        showTimeOffHint ? (
          <Callout
            severity="info"
            className="calendar-event-dialog__show-as-hint"
            title={labels.eventShowAsAllDayFreeHint}
          />
        ) : null
      }
    >
      <Select
        value={form.freeBusyStatus}
        onValueChange={(value) => onFieldChange("freeBusyStatus", value as CalendarFreeBusyStatus)}
        disabled={disabled}
      >
        <CollectionGhostSelectTrigger id={showAsId} label={<SelectValue />} />
        <SelectContent align="end">
          <SelectItem value="busy">{labels.eventShowAsBusy}</SelectItem>
          <SelectItem value="free">{labels.eventShowAsFree}</SelectItem>
        </SelectContent>
      </Select>
    </FieldLabelRow>
  );
}
