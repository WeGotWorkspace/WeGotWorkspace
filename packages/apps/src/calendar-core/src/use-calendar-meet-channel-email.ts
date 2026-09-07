import { useEffect, useRef, useState } from "react";
import type { CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import {
  applyMeetChannelEmailChoice,
  guestRoomReplacementForChannelUrl,
  hasMeetChannelEmailCollision,
  hasMeetChannelEmailCollisionOnSave,
  isCalendarMeetChannelUrl,
  type MeetChannelEmailChoice,
} from "@/calendar-core/src/calendar-meet-channel-email";
import {
  calendarMeetOwnerPrincipal,
  formEventEndMs,
  meetRemoveExpiresAt,
  resolveCalendarMeetReserveScope,
  resolveMeetReserveExpiresAt,
  type CalendarMeetOperations,
} from "@/calendar-core/src/calendar-meet-link";
import type { RecurrenceEditScope } from "@/calendar-core/src/calendar-recurrence-scope";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";

export type UseCalendarMeetChannelEmailCollisionInput = {
  form: CalendarEventFormValue;
  invitees: CalendarInvitee[];
  open: boolean;
  workspaceOrigin: string;
  meetOperations?: CalendarMeetOperations;
  calendar?: CalendarInfo;
  username?: string;
  recurrenceId?: string;
  recurrenceSaveScope?: RecurrenceEditScope;
  onChange: (next: CalendarEventFormValue) => void;
  onSave: (scope?: RecurrenceEditScope) => void;
};

/**
 * Prompt when a # channel Meet URL collides with email-only invitees.
 * Meeting URLs (`/meet/meetings/…`) never prompt.
 *
 * Cancel after an in-form conflict reverts that last change. Cancel after a
 * save-time prompt leaves the form as-is and aborts save.
 */
export function useCalendarMeetChannelEmailCollision({
  form,
  invitees,
  open,
  workspaceOrigin,
  meetOperations,
  calendar,
  username,
  recurrenceId,
  recurrenceSaveScope,
  onChange,
  onSave,
}: UseCalendarMeetChannelEmailCollisionInput) {
  const [collisionOpen, setCollisionOpen] = useState(false);
  const [collisionBusy, setCollisionBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const revertFormRef = useRef<CalendarEventFormValue | null>(null);
  const collidingFormRef = useRef<CalendarEventFormValue | null>(null);
  const collisionSourceRef = useRef<"form" | "save">("form");
  const pendingSaveScopeRef = useRef<RecurrenceEditScope | undefined>(undefined);
  const seededOpenRef = useRef(false);

  const collisionInput = {
    meetingUrl: form.meetingUrl,
    attendees: form.attendees,
    invitees,
  };
  const saveCollides = hasMeetChannelEmailCollisionOnSave(collisionInput);
  const showEmailGuestHint = hasMeetChannelEmailCollision(collisionInput);

  useEffect(() => {
    if (!open) {
      seededOpenRef.current = false;
      setCollisionOpen(false);
      setAcknowledged(false);
      setCollisionBusy(false);
      revertFormRef.current = null;
      collidingFormRef.current = null;
      collisionSourceRef.current = "form";
      pendingSaveScopeRef.current = undefined;
      return;
    }
    if (seededOpenRef.current) return;
    seededOpenRef.current = true;
    if (
      hasMeetChannelEmailCollision({
        meetingUrl: form.meetingUrl,
        attendees: form.attendees,
        invitees,
      })
    ) {
      setAcknowledged(true);
    }
  }, [form.attendees, form.meetingUrl, invitees, open]);

  useEffect(() => {
    if (!open || saveCollides) return;
    setAcknowledged(false);
  }, [open, saveCollides]);

  const cancelCollision = (): void => {
    if (collisionBusy) return;
    if (collisionSourceRef.current === "form" && revertFormRef.current) {
      onChange(revertFormRef.current);
    }
    revertFormRef.current = null;
    collidingFormRef.current = null;
    pendingSaveScopeRef.current = undefined;
    collisionSourceRef.current = "form";
    setCollisionOpen(false);
  };

  const commitForm = (next: CalendarEventFormValue): void => {
    const was = hasMeetChannelEmailCollision({
      meetingUrl: form.meetingUrl,
      attendees: form.attendees,
      invitees,
    });
    const will = hasMeetChannelEmailCollision({
      meetingUrl: next.meetingUrl,
      attendees: next.attendees,
      invitees,
    });
    if (!was && will) {
      revertFormRef.current = form;
      collidingFormRef.current = next;
      collisionSourceRef.current = "form";
      setCollisionOpen(true);
    }
    onChange(next);
  };

  const trySave = (scope?: RecurrenceEditScope): void => {
    if (saveCollides && !acknowledged) {
      revertFormRef.current = null;
      collidingFormRef.current = form;
      collisionSourceRef.current = "save";
      pendingSaveScopeRef.current = scope;
      setCollisionOpen(true);
      return;
    }
    onSave(scope);
  };

  const applyChoice = async (choice: MeetChannelEmailChoice): Promise<void> => {
    if (collisionBusy) return;
    const source = collisionSourceRef.current;
    const saveScope = pendingSaveScopeRef.current;
    const current = collidingFormRef.current ?? form;
    let next = current;
    if (choice === "replace-with-room") {
      setCollisionBusy(true);
      const room = guestRoomReplacementForChannelUrl(current.meetingUrl, workspaceOrigin);
      const reserve = meetOperations?.reserveRoom;
      const ownerPrincipal = calendarMeetOwnerPrincipal(calendar, username);
      if (reserve && ownerPrincipal && isCalendarMeetChannelUrl(current.meetingUrl)) {
        try {
          const scope = resolveCalendarMeetReserveScope({
            recurrencePreset: current.recurrencePreset,
            recurrenceId,
            recurrenceSaveScope,
          });
          await reserve({
            room: room.roomCode,
            ownerPrincipal,
            expiresAt: resolveMeetReserveExpiresAt(scope, formEventEndMs(current)),
          });
        } catch {
          try {
            await meetOperations?.patchRoomExpiresAt?.({
              room: room.roomCode,
              expiresAt: meetRemoveExpiresAt(),
            });
          } catch {
            // Best-effort; the generated href still replaces the channel URL.
          }
        }
      }
      next = applyMeetChannelEmailChoice(current, choice, invitees, room);
      setCollisionBusy(false);
    } else {
      next = applyMeetChannelEmailChoice(current, choice, invitees);
    }
    if (choice === "keep-both") setAcknowledged(true);
    else setAcknowledged(false);
    revertFormRef.current = null;
    collidingFormRef.current = null;
    collisionSourceRef.current = "form";
    pendingSaveScopeRef.current = undefined;
    setCollisionOpen(false);
    onChange(next);
    if (source === "save") onSave(saveScope);
  };

  return {
    commitForm,
    trySave,
    collisionOpen,
    collisionBusy,
    showEmailGuestHint,
    cancelCollision,
    applyChoice,
  };
}
