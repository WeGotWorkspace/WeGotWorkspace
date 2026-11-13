import { Bell, StickyNote } from "lucide-react";
import { useId } from "react";
import { AlarmsRows } from "@/alarms-card/src/alarms-card";
import type { CalendarInvitee } from "@/lib/models/calendar-attendees";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import { CalendarInviteesCard } from "@/calendar-core/src/calendar-invitees-card";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { useInviteeAvailability } from "@/calendar-core/src/use-invitee-availability";
import type { ContactCard } from "@/lib/models/contacts-types";
import type { ControlSize } from "@/ui/control-size";
import { FieldLabelRow } from "@/ui/field-label-row";
import { TextareaAutosize } from "@/ui/textarea-autosize";
import "@/note-detail-view/src/note-detail-view.css";

type CalendarEventFormFieldChange = <K extends keyof CalendarEventFormValue>(
  key: K,
  value: CalendarEventFormValue[K],
) => void;

export type CalendarEventFormSecondaryProps = {
  form: CalendarEventFormValue;
  labels: CalendarUILabels;
  invitees: CalendarInvitee[];
  contactCards: ContactCard[];
  onRefreshContactCards?: () => void;
  busy: boolean;
  readOnly: boolean;
  fieldsDisabled: boolean;
  canSubmitEmail: boolean;
  noTeam?: boolean;
  sessionEmail?: string;
  /** The viewer, for their own participant row. */
  self?: CalendarInvitee;
  controlSize: ControlSize;
  meetEmailGuestHint?: string;
  hideInvitees?: boolean;
  hideAlarms?: boolean;
  hideNotes?: boolean;
  /** Saved event being edited, for the invitee busy warnings (#1614). */
  availabilityEventId?: string;
  onFieldChange: CalendarEventFormFieldChange;
};

/** Invitees, alarms, and notes band for the shared event form. */
export function CalendarEventFormSecondary({
  form,
  labels,
  invitees,
  contactCards,
  onRefreshContactCards,
  busy,
  readOnly,
  fieldsDisabled,
  canSubmitEmail,
  noTeam = false,
  sessionEmail,
  self,
  controlSize,
  meetEmailGuestHint,
  hideInvitees = false,
  hideAlarms = false,
  hideNotes = false,
  availabilityEventId,
  onFieldChange,
}: CalendarEventFormSecondaryProps) {
  const notesId = useId();
  // Planning aid for whoever edits the event; a read-only view asks nothing.
  const availability = useInviteeAvailability({
    form,
    invitees,
    eventId: availabilityEventId,
    enabled: !hideInvitees && !readOnly,
  });
  return (
    <div className="calendar-event-dialog__secondary">
      <div className="calendar-event-dialog__secondary-start">
        {hideInvitees ? null : (
          <CalendarInviteesCard
            className="calendar-event-dialog__field calendar-event-dialog__field--invitees"
            presentation="field"
            attendees={form.attendees}
            invitees={invitees}
            contactCards={contactCards}
            onRefreshContactCards={onRefreshContactCards}
            labels={labels}
            busy={busy}
            readOnly={readOnly}
            canSubmitEmail={canSubmitEmail}
            noTeam={noTeam}
            sessionEmail={sessionEmail}
            self={self}
            controlSize={controlSize}
            meetEmailGuestHint={meetEmailGuestHint}
            availability={availability}
            onChange={(attendees) => onFieldChange("attendees", attendees)}
          />
        )}
      </div>

      <div className="calendar-event-dialog__secondary-end">
        {hideAlarms ? null : (
          <FieldLabelRow
            className="calendar-event-dialog__field calendar-event-dialog__field--alarms"
            layout="inline"
            label={labels.eventAlarmsLabel}
            labelIcon={<Bell aria-hidden />}
          >
            <div className="calendar-event-dialog__alarms-field">
              <AlarmsRows
                alerts={form.alerts}
                labels={labels}
                disabled={fieldsDisabled}
                readOnly={readOnly}
                controlSize={controlSize}
                onChange={(alerts) => onFieldChange("alerts", alerts)}
              />
            </div>
          </FieldLabelRow>
        )}

        {hideNotes ? null : (
          <FieldLabelRow
            className="calendar-event-dialog__field calendar-event-dialog__field--notes"
            layout="inline"
            fill
            label={labels.eventNotesLabel}
            labelIcon={<StickyNote aria-hidden />}
            htmlFor={notesId}
          >
            <TextareaAutosize
              id={notesId}
              className="note-detail-view__notes calendar-event-dialog__notes"
              value={form.description}
              onChange={(event) => onFieldChange("description", event.target.value)}
              placeholder={labels.eventNotesPlaceholder}
              disabled={fieldsDisabled}
              minRows={2}
              // Grows with the text, however long: the form scrolls, not the field.
              maxRows={Number.POSITIVE_INFINITY}
            />
          </FieldLabelRow>
        )}
      </div>
    </div>
  );
}
