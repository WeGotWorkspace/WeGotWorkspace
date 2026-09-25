import { Type } from "lucide-react";
import { CalendarEventCalendarPicker } from "@/calendar-core/src/calendar-event-calendar-picker";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import type { ControlSize } from "@/ui/control-size";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";

type CalendarEventFormFieldChange = <K extends keyof CalendarEventFormValue>(
  key: K,
  value: CalendarEventFormValue[K],
) => void;

export type CalendarEventFormTitleProps = {
  form: CalendarEventFormValue;
  calendars: CalendarInfo[];
  labels: CalendarUILabels;
  controlSize: ControlSize;
  busy: boolean;
  readOnly: boolean;
  fieldsDisabled: boolean;
  autoFocusTitle: boolean;
  hideCalendarPicker?: boolean;
  calendarPickerInteractive: boolean;
  showInviteeRsvp: boolean;
  invitationMode: boolean;
  draftCalendarId: string;
  incomingRsvp?: CalendarSchedulingRespondStatus;
  onDraftCalendarIdChange: (calendarId: string) => void;
  onRsvp?: (
    status: CalendarSchedulingRespondStatus,
    calendarId?: string,
  ) => void | boolean | Promise<void | boolean>;
  onFieldChange: CalendarEventFormFieldChange;
};

/** Title field and calendar picker for the shared event form. */
export function CalendarEventFormTitle({
  form,
  calendars,
  labels,
  controlSize,
  busy,
  readOnly,
  fieldsDisabled,
  autoFocusTitle,
  hideCalendarPicker = false,
  calendarPickerInteractive,
  showInviteeRsvp,
  invitationMode,
  draftCalendarId,
  incomingRsvp,
  onDraftCalendarIdChange,
  onRsvp,
  onFieldChange,
}: CalendarEventFormTitleProps) {
  return (
    <FieldLabelRow
      className="calendar-event-dialog__field calendar-event-dialog__field--title"
      label={labels.eventTitleLabel}
      labelMode="icon"
      icon={<Type className="size-3.5" aria-hidden />}
    >
      <NameColorRow className="calendar-event-dialog__title-row">
        <Input
          className={NAME_COLOR_ROW_INPUT_CLASS}
          size={controlSize}
          value={form.title}
          onChange={(event) => onFieldChange("title", event.target.value)}
          placeholder={labels.eventTitleLabel}
          aria-label={labels.eventTitleLabel}
          disabled={fieldsDisabled}
          autoFocus={autoFocusTitle && !readOnly}
        />
        {hideCalendarPicker ? null : (
          <CalendarEventCalendarPicker
            calendars={calendars}
            calendarId={calendarPickerInteractive ? draftCalendarId : form.calendarId}
            labels={labels}
            size={controlSize}
            disabled={busy || (readOnly && !calendarPickerInteractive)}
            onCalendarIdChange={(calendarId) => {
              if (showInviteeRsvp) {
                onDraftCalendarIdChange(calendarId);
                return;
              }
              if (invitationMode) {
                if (busy || calendarId === draftCalendarId) return;
                const previous = draftCalendarId;
                onDraftCalendarIdChange(calendarId);
                // needs-action / declined: keep local until Accept/Maybe (Decline ignores calendarId).
                const persisted = incomingRsvp;
                if (!persisted || persisted === "declined") return;
                void Promise.resolve(onRsvp?.(persisted, calendarId || undefined)).catch(() => {
                  onDraftCalendarIdChange(previous);
                });
                return;
              }
              onFieldChange("calendarId", calendarId);
            }}
          />
        )}
      </NameColorRow>
    </FieldLabelRow>
  );
}
