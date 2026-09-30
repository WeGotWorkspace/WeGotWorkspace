import { Trash2 } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { CalendarRsvpActions, CalendarRsvpSelect } from "@/calendar-core/src/calendar-rsvp-actions";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import type { ControlSize } from "@/ui/control-size";

export type CalendarEventFormFooterProps = {
  mode: "create" | "edit" | "invitation";
  labels: CalendarUILabels;
  busy: boolean;
  controlSize: ControlSize;
  readOnly: boolean;
  valid: boolean;
  canSubmit: boolean;
  saveLabel: string;
  showInvitationRsvp: boolean;
  showInviteeRsvp: boolean;
  showSaveCancel: boolean;
  inviteeRsvp?: string | null;
  draftRsvp: CalendarSchedulingRespondStatus | "";
  draftCalendarId: string;
  onDraftRsvpChange: (status: CalendarSchedulingRespondStatus) => void;
  onRsvp?: (
    status: CalendarSchedulingRespondStatus,
    calendarId?: string,
  ) => void | boolean | Promise<void | boolean>;
  onDelete?: () => void;
  onDismiss: () => void;
};

/** RSVP, delete, and save/cancel actions for the shared event form. */
export function CalendarEventFormFooter({
  mode,
  labels,
  busy,
  controlSize,
  readOnly,
  valid,
  canSubmit,
  saveLabel,
  showInvitationRsvp,
  showInviteeRsvp,
  showSaveCancel,
  inviteeRsvp,
  draftRsvp,
  draftCalendarId,
  onDraftRsvpChange,
  onRsvp,
  onDelete,
  onDismiss,
}: CalendarEventFormFooterProps) {
  return (
    <footer className="calendar-event-dialog__footer">
      {showInvitationRsvp && onRsvp ? (
        <div className="calendar-event-dialog__invitation-rsvp">
          <CalendarRsvpActions
            className="calendar-event-dialog__rsvp-actions"
            currentStatus={inviteeRsvp ?? undefined}
            labels={labels}
            busy={busy}
            size="sm"
            showLabels
            onRespond={(status) =>
              onRsvp(status, status === "declined" ? undefined : draftCalendarId || undefined)
            }
          />
        </div>
      ) : null}
      {showInviteeRsvp ? (
        <CalendarRsvpSelect
          className="calendar-event-dialog__rsvp"
          value={draftRsvp}
          labels={labels}
          busy={busy}
          onChange={onDraftRsvpChange}
        />
      ) : null}
      {mode === "edit" && onDelete && !readOnly ? (
        <IconButton
          type="button"
          variant="outline"
          severity="danger"
          size={controlSize}
          className="calendar-event-dialog__delete"
          icon={<Trash2 className="size-3.5" aria-hidden />}
          label={labels.delete}
          onClick={onDelete}
          disabled={busy}
        />
      ) : null}
      {showSaveCancel ? (
        <div className="calendar-event-dialog__footer-end">
          <Button
            type="button"
            variant="outline"
            size={controlSize}
            label={labels.cancel}
            onClick={onDismiss}
            disabled={busy}
          />
          <Button
            type="submit"
            size={controlSize}
            label={saveLabel}
            disabled={showInviteeRsvp ? !draftRsvp || busy : !valid || busy || canSubmit === false}
          />
        </div>
      ) : null}
    </footer>
  );
}
