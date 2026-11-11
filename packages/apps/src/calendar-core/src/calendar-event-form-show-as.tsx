import { CircleDot } from "lucide-react";
import { Callout } from "@/callout/src/callout";
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
  /** Someone else's event: no time-off hint, the viewer cannot change it. */
  readOnly?: boolean;
  onFieldChange: CalendarEventFormFieldChange;
};

/** Busy/free availability field for the shared event form. All-day Free gets a time-off hint. */
export function CalendarEventFormShowAs({
  form,
  labels,
  controlSize,
  disabled,
  readOnly = false,
  onFieldChange,
}: CalendarEventFormShowAsProps) {
  const showTimeOffHint = !readOnly && form.allDay && form.freeBusyStatus === "free";
  return (
    <FieldLabelRow
      className="calendar-event-dialog__field calendar-event-dialog__field--availability"
      label={labels.eventShowAs}
      labelMode="icon"
      icon={<CircleDot className="size-3.5" aria-hidden />}
    >
      <div className="calendar-event-dialog__show-as-field">
        <Select
          value={form.freeBusyStatus}
          onValueChange={(value) =>
            onFieldChange("freeBusyStatus", value as CalendarFreeBusyStatus)
          }
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
        {showTimeOffHint ? (
          <Callout
            severity="info"
            className="calendar-event-dialog__show-as-hint"
            title={labels.eventShowAsAllDayFreeHint}
          />
        ) : null}
      </div>
    </FieldLabelRow>
  );
}
