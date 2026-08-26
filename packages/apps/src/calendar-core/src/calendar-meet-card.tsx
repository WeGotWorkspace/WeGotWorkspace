import { useRef, useState } from "react";
import { Video } from "lucide-react";
import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { CardRow } from "@/card/src/card-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import {
  patchCalendarEventForm,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarMeetOwnerPrincipal,
  formEventEndMs,
  isHttpUrl,
  meetRemoveExpiresAt,
  parseCalendarMeetHref,
  resolveCalendarMeetReserveScope,
  resolveMeetReserveExpiresAt,
  roomCodeFromMeetingUrl,
  type CalendarMeetOperations,
} from "@/calendar-core/src/calendar-meet-link";
import type { RecurrenceEditScope } from "@/calendar-core/src/calendar-recurrence-scope";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import { createMeetRoomCode } from "@/meet-core/src/meet-room-id";
import { buildMeetGuestCallLink } from "@/meet-core/src/meet-route-search";
import { CalendarMeetJoin } from "@/calendar-core/src/calendar-meet-join";

export type CalendarMeetCardProps = {
  form: CalendarEventFormValue;
  labels: CalendarUILabels;
  calendar?: CalendarInfo;
  username?: string;
  workspaceOrigin: string;
  recurrenceId?: string;
  recurrenceSaveScope?: RecurrenceEditScope;
  thisInstanceLocked?: boolean;
  meetOperations?: CalendarMeetOperations;
  disabled?: boolean;
  readOnly?: boolean;
  onChange: (next: CalendarEventFormValue) => void;
  onRecurrenceSaveScopeChange?: (scope: RecurrenceEditScope) => void;
  onJoin?: (href: string) => void;
};

function applyForm(
  form: CalendarEventFormValue,
  patch: Partial<CalendarEventFormValue>,
  onChange: (next: CalendarEventFormValue) => void,
): CalendarEventFormValue {
  const next = patchCalendarEventForm(form, patch);
  onChange(next);
  return next;
}

export function CalendarMeetCard({
  form,
  labels,
  calendar,
  username,
  workspaceOrigin,
  recurrenceId,
  recurrenceSaveScope,
  thisInstanceLocked = false,
  meetOperations,
  disabled = false,
  readOnly = false,
  onChange,
  onRecurrenceSaveScopeChange,
  onJoin,
}: CalendarMeetCardProps) {
  const [reserving, setReserving] = useState(false);
  const inflightRef = useRef(false);
  const reservedThisSessionRef = useRef(Boolean(form.meetRoomCode));
  const canChooseScope = Boolean(recurrenceId) && !thisInstanceLocked && !readOnly;
  const scope = resolveCalendarMeetReserveScope({
    recurrencePreset: form.recurrencePreset,
    recurrenceId,
    recurrenceSaveScope: thisInstanceLocked ? "thisInstance" : recurrenceSaveScope,
  });

  const expireStagedRoom = async (room: string): Promise<void> => {
    const patch = meetOperations?.patchRoomExpiresAt;
    if (!patch) return;
    try {
      await patch({ room, expiresAt: meetRemoveExpiresAt() });
    } catch {
      // Best-effort GC clock; the form still clears.
    }
  };

  const addMeet = async (): Promise<void> => {
    const reserve = meetOperations?.reserveRoom;
    const ownerPrincipal = calendarMeetOwnerPrincipal(calendar, username);
    if (!reserve || !ownerPrincipal || inflightRef.current || reserving) return;
    inflightRef.current = true;
    setReserving(true);
    const room = form.meetRoomCode?.trim() || createMeetRoomCode();
    if (!form.meetRoomCode) {
      applyForm(form, { meetRoomCode: room }, onChange);
    }
    try {
      const eventEndMs = formEventEndMs(form);
      await reserve({
        room,
        ownerPrincipal,
        expiresAt: resolveMeetReserveExpiresAt(scope, eventEndMs),
      });
      reservedThisSessionRef.current = true;
      const href = buildMeetGuestCallLink(room, workspaceOrigin);
      applyForm({ ...form, meetRoomCode: room }, { meetingUrl: href, meetRoomCode: room }, onChange);
    } finally {
      inflightRef.current = false;
      setReserving(false);
    }
  };

  const removeMeet = async (): Promise<void> => {
    const room =
      form.meetRoomCode?.trim() || roomCodeFromMeetingUrl(form.meetingUrl, workspaceOrigin);
    if (room) await expireStagedRoom(room);
    reservedThisSessionRef.current = false;
    applyForm(form, { meetingUrl: "", meetRoomCode: undefined }, onChange);
  };

  const changeScope = async (next: RecurrenceEditScope): Promise<void> => {
    if (next === recurrenceSaveScope) return;
    if (reservedThisSessionRef.current || form.meetRoomCode) {
      await removeMeet();
    } else if (form.meetingUrl.trim()) {
      applyForm(form, { meetingUrl: "" }, onChange);
    }
    onRecurrenceSaveScopeChange?.(next);
  };

  const onUrlBlur = async (): Promise<void> => {
    const raw = form.meetingUrl.trim();
    if (!raw) return;
    if (!isHttpUrl(raw)) {
      applyForm(form, { meetingUrl: "" }, onChange);
      return;
    }
    const parsed = parseCalendarMeetHref(raw, workspaceOrigin);
    const reserve = meetOperations?.reserveRoom;
    const ownerPrincipal = calendarMeetOwnerPrincipal(calendar, username);
    if (parsed?.kind !== "wgw" || !reserve || !ownerPrincipal) return;
    try {
      await reserve({
        room: parsed.room,
        ownerPrincipal,
        expiresAt: meetRemoveExpiresAt(),
      });
      reservedThisSessionRef.current = true;
      applyForm(form, { meetRoomCode: parsed.room, meetingUrl: raw }, onChange);
    } catch {
      // Paste still stores the href; persist-path reserve is authoritative.
    }
  };

  if (readOnly) {
    if (!form.meetingUrl.trim()) return null;
    return (
      <div className="calendar-event-dialog__meet-readonly">
        <CalendarMeetJoin
          href={form.meetingUrl}
          labels={labels}
          workspaceOrigin={workspaceOrigin}
          meetOperations={meetOperations}
          onJoin={onJoin}
        />
      </div>
    );
  }

  return (
    <Card
      className="calendar-event-dialog__card calendar-event-dialog__meet"
      titleIcon={<Video className="size-4" />}
      title={labels.eventMeetSectionTitle}
    >
      {canChooseScope ? (
        <CardRow title={labels.eventMeetApplyTo}>
          <Select
            value={recurrenceSaveScope ?? "thisAndFuture"}
            onValueChange={(value) => {
              void changeScope(value as RecurrenceEditScope);
            }}
            disabled={disabled || reserving}
          >
            <SelectTrigger
              className="calendar-event-dialog__meet-scope-trigger"
              aria-label={labels.eventMeetApplyTo}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="thisInstance">{labels.recurrenceScopeThisInstance}</SelectItem>
              <SelectItem value="thisAndFuture">{labels.recurrenceScopeThisAndFuture}</SelectItem>
            </SelectContent>
          </Select>
        </CardRow>
      ) : null}
      <CardRow fill>
        <div className="calendar-event-dialog__meet-row">
          <Input
            value={form.meetingUrl}
            onChange={(event) => applyForm(form, { meetingUrl: event.target.value }, onChange)}
            onBlur={() => {
              void onUrlBlur();
            }}
            placeholder={labels.eventMeetUrlPlaceholder}
            aria-label={labels.eventMeetUrlLabel}
            disabled={disabled}
            inputMode="url"
            autoComplete="off"
          />
          {form.meetingUrl.trim() ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                void removeMeet();
              }}
              disabled={disabled || reserving}
            >
              {labels.eventMeetRemove}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void addMeet();
              }}
              disabled={disabled || reserving || !meetOperations?.reserveRoom}
            >
              {labels.eventMeetAdd}
            </Button>
          )}
        </div>
      </CardRow>
    </Card>
  );
}
