import { CircleDot } from "lucide-react";
import { type CalendarFreeBusyStatus } from "@/calendar-core/src/calendar-alerts";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { ControlSize } from "@/ui/control-size";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

type CalendarEventFormFieldChange = <K extends keyof CalendarEventFormValue>(
  key: K,
  value: CalendarEventFormValue[K],
) => void;

export type CalendarEventFormShowAsProps = {
  form: CalendarEventFormValue;
  labels: CalendarUILabels;
  controlSize: ControlSize;
  disabled: boolean;
  onFieldChange: CalendarEventFormFieldChange;
};

/** Busy/free availability field for the shared event form. */
export function CalendarEventFormShowAs({
  form,
  labels,
  controlSize,
  disabled,
  onFieldChange,
}: CalendarEventFormShowAsProps) {
  return (
    <FieldLabelRow
      className="calendar-event-dialog__field calendar-event-dialog__field--availability"
      label={labels.eventShowAs}
      labelMode="icon"
      icon={<CircleDot className="size-3.5" aria-hidden />}
    >
      <Select
        value={form.freeBusyStatus}
        onValueChange={(value) => onFieldChange("freeBusyStatus", value as CalendarFreeBusyStatus)}
        disabled={disabled}
      >
        <SelectTrigger
          size={controlSize}
          className="calendar-event-dialog__show-as-trigger"
          aria-label={labels.eventShowAs}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="busy">{labels.eventShowAsBusy}</SelectItem>
          <SelectItem value="free">{labels.eventShowAsFree}</SelectItem>
        </SelectContent>
      </Select>
    </FieldLabelRow>
  );
}
