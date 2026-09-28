import { Bell, StickyNote, Users } from "lucide-react";
import { CalendarAlarmsRows } from "@/calendar-core/src/calendar-alarms-card";
import type { CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import { CalendarInviteesCard } from "@/calendar-core/src/calendar-invitees-card";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import type { ControlSize } from "@/ui/control-size";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Textarea } from "@/ui/textarea";

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
  sessionEmail?: string;
  controlSize: ControlSize;
  meetEmailGuestHint?: string;
  hideInvitees?: boolean;
  hideAlarms?: boolean;
  hideNotes?: boolean;
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
  sessionEmail,
  controlSize,
  meetEmailGuestHint,
  hideInvitees = false,
  hideAlarms = false,
  hideNotes = false,
  onFieldChange,
}: CalendarEventFormSecondaryProps) {
  return (
    <div className="calendar-event-dialog__secondary">
      <div className="calendar-event-dialog__secondary-start">
        {hideInvitees ? null : (
          <CalendarInviteesCard
            className="calendar-event-dialog__field calendar-event-dialog__field--invitees"
            presentation="field"
            fieldIcon={<Users className="size-3.5" aria-hidden />}
            attendees={form.attendees}
            invitees={invitees}
            contactCards={contactCards}
            onRefreshContactCards={onRefreshContactCards}
            labels={labels}
            busy={busy}
            readOnly={readOnly}
            canSubmitEmail={canSubmitEmail}
            sessionEmail={sessionEmail}
            controlSize={controlSize}
            meetEmailGuestHint={meetEmailGuestHint}
            onChange={(attendees) => onFieldChange("attendees", attendees)}
          />
        )}
      </div>

      <div className="calendar-event-dialog__secondary-end">
        {hideAlarms ? null : (
          <FieldLabelRow
            className="calendar-event-dialog__field calendar-event-dialog__field--alarms"
            label={labels.eventAlarmsLabel}
            labelMode="icon"
            icon={<Bell className="size-3.5" aria-hidden />}
          >
            <div className="calendar-event-dialog__alarms-field">
              <CalendarAlarmsRows
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
            label={labels.eventNotesLabel}
            labelMode="icon"
            icon={<StickyNote className="size-3.5" aria-hidden />}
          >
            <Textarea
              size={controlSize}
              value={form.description}
              onChange={(event) => onFieldChange("description", event.target.value)}
              placeholder={labels.eventNotesLabel}
              aria-label={labels.eventNotesLabel}
              disabled={fieldsDisabled}
              rows={3}
            />
          </FieldLabelRow>
        )}
      </div>
    </div>
  );
}
