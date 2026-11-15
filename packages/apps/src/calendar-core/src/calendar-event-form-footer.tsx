import { Trash2 } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { CalendarRsvpActions, CalendarRsvpSelect } from "@/calendar-core/src/calendar-rsvp-actions";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import type { ControlSize } from "@/ui/control-size";
import { DialogFooter } from "@/ui/dialog";

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
  const rsvpSelect = showInviteeRsvp ? (
    <CalendarRsvpSelect
      value={draftRsvp}
      labels={labels}
      busy={busy}
      onChange={onDraftRsvpChange}
    />
  ) : null;
  const deleteButton =
    mode === "edit" && onDelete && !readOnly ? (
      <IconButton
        type="button"
        variant="outline"
        severity="danger"
        size={controlSize}
        icon={<Trash2 className="size-3.5" aria-hidden />}
        label={labels.delete}
        onClick={onDelete}
        disabled={busy}
      />
    ) : null;
  const start =
    rsvpSelect || deleteButton ? (
      <>
        {rsvpSelect}
        {deleteButton}
      </>
    ) : null;

  return (
    <DialogFooter start={start}>
      {showInvitationRsvp && onRsvp ? (
        <CalendarRsvpActions
          currentStatus={inviteeRsvp ?? undefined}
          labels={labels}
          busy={busy}
          size="sm"
          showLabels
          onRespond={(status) =>
            onRsvp(status, status === "declined" ? undefined : draftCalendarId || undefined)
          }
        />
      ) : null}
      {showSaveCancel ? (
        <>
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
        </>
      ) : null}
    </DialogFooter>
  );
}
