import { Type } from "lucide-react";
import { useId } from "react";
import {
  CalendarEventCalendarPicker,
  writableCalendarsForPicker,
} from "@/calendar-core/src/calendar-event-calendar-picker";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import type { ControlSize } from "@/ui/control-size";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";
import { CollectionSelect } from "@/ui/collection-select";
import { CollectionColorDot } from "@/ui/collection-color-dot";
import { NoteDetailTitle } from "@/note-detail-view/src/note-detail-title";

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
  /**
   * `row` (default): a Title row with the calendar swatch at its end. `heading`: the
   * calendar dropdown above a large title, as a task or a note.
   */
  variant?: "row" | "heading";
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
  variant = "row",
}: CalendarEventFormTitleProps) {
  const titleId = useId();
  const calendarId = calendarPickerInteractive ? draftCalendarId : form.calendarId;
  const calendarDisabled = busy || (readOnly && !calendarPickerInteractive);
  const changeCalendar = (nextId: string) => {
    if (showInviteeRsvp) {
      onDraftCalendarIdChange(nextId);
      return;
    }
    if (invitationMode) {
      if (busy || nextId === draftCalendarId) return;
      const previous = draftCalendarId;
      onDraftCalendarIdChange(nextId);
      // needs-action / declined: keep local until Accept/Maybe (Decline ignores calendarId).
      const persisted = incomingRsvp;
      if (!persisted || persisted === "declined") return;
      void Promise.resolve(onRsvp?.(persisted, nextId || undefined)).catch(() => {
        onDraftCalendarIdChange(previous);
      });
      return;
    }
    onFieldChange("calendarId", nextId);
  };

  if (variant === "heading") {
    const writable = writableCalendarsForPicker(calendars);
    const current = calendars.find((calendar) => calendar.id === calendarId) ?? writable[0];
    // A read-only calendar still names itself on the trigger.
    const options =
      current && !writable.some((calendar) => calendar.id === current.id)
        ? [current, ...writable]
        : writable;
    return (
      <div className="calendar-event-dialog__heading">
        <NoteDetailTitle
          value={form.title}
          placeholder={labels.eventTitlePlaceholder}
          label={labels.eventTitleLabel}
          onChange={fieldsDisabled ? undefined : (title) => onFieldChange("title", title)}
          autoFocus={autoFocusTitle && !readOnly}
          eyebrow={
            hideCalendarPicker || !current ? null : (
              <CollectionSelect
                items={options.map(({ id, name, color }) => ({ id, name, color }))}
                value={current.id}
                dot={<CollectionColorDot />}
                color={current.color}
                triggerLabel={current.name}
                accessibleName={labels.eventCalendarLabel}
                triggerVariant="ghost"
                disabled={calendarDisabled}
                onValueChange={changeCalendar}
              />
            )
          }
        />
      </div>
    );
  }

  return (
    <FieldLabelRow
      className="calendar-event-dialog__field calendar-event-dialog__field--title"
      layout="inline"
      fill
      label={labels.eventTitleLabel}
      labelIcon={<Type aria-hidden />}
      htmlFor={titleId}
    >
      <NameColorRow className="calendar-event-dialog__title-row">
        <Input
          id={titleId}
          className={NAME_COLOR_ROW_INPUT_CLASS}
          size={controlSize}
          value={form.title}
          onChange={(event) => onFieldChange("title", event.target.value)}
          placeholder={labels.eventTitlePlaceholder}
          disabled={fieldsDisabled}
          autoFocus={autoFocusTitle && !readOnly}
        />
        {hideCalendarPicker ? null : (
          <CalendarEventCalendarPicker
            calendars={calendars}
            calendarId={calendarId}
            labels={labels}
            size={controlSize}
            disabled={calendarDisabled}
            onCalendarIdChange={changeCalendar}
          />
        )}
      </NameColorRow>
    </FieldLabelRow>
  );
}
