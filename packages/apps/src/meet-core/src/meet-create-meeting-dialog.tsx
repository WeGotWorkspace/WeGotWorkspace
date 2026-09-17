import { useEffect, useMemo, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { CalendarEventDialog } from "@/calendar-core/src/calendar-event-dialog";
import {
  calendarEventFormIsValid,
  formToDraft,
  formToFullPatch,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { pickDefaultCalendarId } from "@/calendar-core/src/calendar-collection-write";
import {
  calendarMeetOwnerPrincipal,
  formEventEndMs,
  meetEventExpiresAt,
  meetRemoveExpiresAt,
  resolveMeetReserveExpiresAt,
  type CalendarMeetOperations,
} from "@/calendar-core/src/calendar-meet-link";
import type {
  CalendarAPIOperations,
  CalendarEventDraft,
  CalendarInfo,
} from "@/calendar-core/src/calendar-types";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import { calendarInviteesFromShareDirectory } from "@/calendar-core/src/calendar-meet-channel-email";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";
import { Card } from "@/card/src/card";
import { CardRow } from "@/card/src/card-row";
import { Switch } from "@/ui/switch";
import {
  seedEditMeetingForm,
  seedInstantMeetingForm,
  type MeetUpcomingMeeting,
} from "@/meet-core/src/meet-calendar-meeting";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { createMeetRoomCode } from "@/meet-core/src/meet-room-id";
import type { MeetChannel, MeetChannelWriteInput } from "@/meet-core/src/meet-types";
import {
  buildMeetGuestCallLink,
  buildMeetMeetingInviteLink,
} from "@/meet-core/src/meet-route-search";
import "@/calendar-core/src/calendar-workspace.css";
import "@/meet-core/src/meet-channel-dialog.css";
import "./meet-create-meeting-dialog.css";

export type MeetCreateMeetingDialogProps = {
  open: boolean;
  mode?: "create" | "edit";
  event?: JmapCalendarEvent | null;
  channel?: MeetChannel | null;
  leftover?: Pick<MeetUpcomingMeeting, "title" | "href"> | null;
  calendars: CalendarInfo[];
  createEvent?: CalendarAPIOperations["createEvent"];
  patchEvent?: CalendarAPIOperations["patchEvent"];
  createChannel?: (input: MeetChannelWriteInput) => Promise<MeetChannel>;
  patchChannel?: (channelId: string, input: { name: string }) => Promise<MeetChannel>;
  meetOperations?: CalendarMeetOperations;
  sessionUsername?: string;
  sessionDisplayName?: string;
  sessionEmail?: string;
  workspaceOrigin?: string;
  contactCards?: ContactCard[];
  invitees?: CalendarInvitee[];
  directory?: readonly CollectionSharePrincipal[];
  onClose: () => void;
  onCreated?: (event: JmapCalendarEvent, channel?: MeetChannel) => void;
  onUpdated?: (event: JmapCalendarEvent, channel?: MeetChannel) => void;
  onDelete?: () => void;
  onError?: (error: unknown) => void;
};

function withOrganizer(
  draft: CalendarEventDraft,
  email?: string,
  name?: string,
): CalendarEventDraft {
  const trimmed = email?.trim();
  if (!trimmed) return draft;
  return {
    ...draft,
    organizer: { email: trimmed, ...(name?.trim() ? { name: name.trim() } : {}) },
  };
}

function seedReservedInstantMeeting(
  calendarId: string,
  workspaceOrigin: string,
): CalendarEventFormValue {
  const room = createMeetRoomCode();
  return seedInstantMeetingForm({
    calendarId,
    now: Temporal.Now.zonedDateTimeISO(),
    meetingUrl: buildMeetGuestCallLink(room, workspaceOrigin),
    meetRoomCode: room,
  });
}

export function MeetCreateMeetingDialog({
  open,
  mode = "create",
  event = null,
  channel = null,
  leftover = null,
  calendars,
  createEvent,
  patchEvent,
  createChannel,
  patchChannel,
  meetOperations,
  sessionUsername,
  sessionDisplayName,
  sessionEmail,
  workspaceOrigin = typeof window !== "undefined"
    ? window.location.origin
    : "https://workspace.example.com",
  contactCards = [],
  invitees,
  directory,
  onClose,
  onCreated,
  onUpdated,
  onDelete,
  onError,
}: MeetCreateMeetingDialogProps) {
  const calendarId = useMemo(() => pickDefaultCalendarId(calendars) ?? "", [calendars]);
  const [scheduled, setScheduled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<CalendarEventFormValue>(() =>
    seedReservedInstantMeeting(calendarId, workspaceOrigin),
  );
  const formRef = useRef(form);
  formRef.current = form;
  const roomRef = useRef(form.meetRoomCode ?? "");
  const savedRef = useRef(false);

  const calendarsRef = useRef(calendars);
  calendarsRef.current = calendars;
  const meetOperationsRef = useRef(meetOperations);
  meetOperationsRef.current = meetOperations;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const eventId = event?.id ?? null;
  const channelId = channel?.id ?? null;
  const leftoverHref = leftover?.href ?? null;
  const editSeedRef = useRef({ event, channel, leftover });
  editSeedRef.current = { event, channel, leftover };

  useEffect(() => {
    if (!open) return;
    savedRef.current = false;
    setBusy(false);
    if (mode === "edit") {
      setScheduled(true);
      roomRef.current = "";
      const seed = editSeedRef.current;
      setForm(
        seedEditMeetingForm({
          calendarId,
          workspaceOrigin,
          event: seed.event,
          channel: seed.channel,
          leftover: seed.leftover,
        }),
      );
      return;
    }
    setScheduled(false);
    const seeded = seedReservedInstantMeeting(calendarId, workspaceOrigin);
    const room = seeded.meetRoomCode?.trim() ?? "";
    roomRef.current = room;
    setForm(seeded);
    const calendar = calendarsRef.current.find((entry) => entry.id === calendarId);
    const ownerPrincipal = calendarMeetOwnerPrincipal(calendar, sessionUsername);
    const reserve = meetOperationsRef.current?.reserveRoom;

    let cancelled = false;
    if (reserve && ownerPrincipal && calendarId) {
      void (async () => {
        try {
          await reserve({
            room,
            ownerPrincipal,
            expiresAt: resolveMeetReserveExpiresAt("single", formEventEndMs(seeded)),
          });
          if (cancelled) {
            await meetOperationsRef.current?.patchRoomExpiresAt?.({
              room,
              expiresAt: meetRemoveExpiresAt(),
            });
          }
        } catch (error) {
          if (!cancelled) onErrorRef.current?.(error);
        }
      })();
    }

    return () => {
      cancelled = true;
      if (!savedRef.current && roomRef.current) {
        const staged = roomRef.current;
        roomRef.current = "";
        void meetOperationsRef.current?.patchRoomExpiresAt?.({
          room: staged,
          expiresAt: meetRemoveExpiresAt(),
        });
      }
    };
  }, [calendarId, channelId, eventId, leftoverHref, mode, open, sessionUsername, workspaceOrigin]);

  const resolvedInvitees = useMemo(
    () => invitees ?? calendarInviteesFromShareDirectory(directory),
    [directory, invitees],
  );

  const applyInstantTimes = (current: CalendarEventFormValue): CalendarEventFormValue => {
    const seeded = seedInstantMeetingForm({
      calendarId: current.calendarId || calendarId,
      now: Temporal.Now.zonedDateTimeISO(),
      meetingUrl: current.meetingUrl,
      meetRoomCode: current.meetRoomCode,
    });
    return {
      ...current,
      startDate: seeded.startDate,
      startTime: seeded.startTime,
      endDate: seeded.endDate,
      endTime: seeded.endTime,
      allDay: false,
    };
  };

  const handleSave = () => {
    const current = formRef.current;
    if (busy) return;
    if (!calendarEventFormIsValid(current) || !current.meetingUrl.trim()) return;
    setBusy(true);
    void (async () => {
      try {
        if (mode === "edit") {
          let nextChannel = channel ?? undefined;
          const title = current.title.trim();
          if (nextChannel && patchChannel && title && title !== nextChannel.name) {
            nextChannel = await patchChannel(nextChannel.id, { name: title });
          }
          const meetingUrl =
            nextChannel && !current.meetGuestRoomOverride
              ? buildMeetMeetingInviteLink(nextChannel.id, workspaceOrigin)
              : current.meetingUrl;
          const nextForm = {
            ...current,
            meetingUrl,
            meetRoomCode: nextChannel?.guestRoomCode ?? current.meetRoomCode,
          };
          let saved: JmapCalendarEvent;
          if (event && patchEvent) {
            saved = await patchEvent(event.id, formToFullPatch(nextForm));
          } else if (createEvent) {
            saved = await createEvent(
              withOrganizer(formToDraft(nextForm), sessionEmail, sessionDisplayName),
            );
          } else {
            return;
          }
          savedRef.current = true;
          onUpdated?.(saved, nextChannel);
          onClose();
          return;
        }
        if (!createEvent) return;
        const createdChannel =
          createChannel && !current.meetGuestRoomOverride
            ? await createChannel({ name: current.title.trim(), kind: "meeting" })
            : undefined;
        const meetingUrl = createdChannel
          ? buildMeetMeetingInviteLink(createdChannel.id, workspaceOrigin)
          : current.meetingUrl;
        const stagedRoom = current.meetRoomCode?.trim() || roomRef.current;
        if (createdChannel && stagedRoom) {
          await meetOperations?.patchRoomExpiresAt?.({
            room: stagedRoom,
            expiresAt: meetRemoveExpiresAt(),
          });
        }
        const draft = withOrganizer(
          formToDraft({
            ...current,
            meetingUrl,
            meetRoomCode: createdChannel?.guestRoomCode ?? current.meetRoomCode,
          }),
          sessionEmail,
          sessionDisplayName,
        );
        const endMs = formEventEndMs(current);
        const room = createdChannel?.guestRoomCode?.trim() || stagedRoom;
        if (room && endMs != null && !createdChannel) {
          await meetOperations?.patchRoomExpiresAt?.({
            room,
            expiresAt: meetEventExpiresAt(endMs),
          });
        }
        const created = await createEvent(draft);
        savedRef.current = true;
        roomRef.current = "";
        onCreated?.(created, createdChannel);
        onClose();
      } catch (error) {
        onError?.(error);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <CalendarEventDialog
      open={open}
      mode={mode}
      form={form}
      calendars={calendars}
      labels={defaultCalendarLabels}
      busy={busy}
      title={mode === "edit" ? meetLabels.editMeeting : meetLabels.newMeeting}
      submitLabel={mode === "edit" ? meetLabels.saveChannelButton : meetLabels.createChannelButton}
      contentClassName="meet-channel-dialog meet-create-meeting-dialog calendar-dialog-surface calendar-event-dialog"
      canSubmit={Boolean(form.meetingUrl.trim())}
      layout={{
        hideLocation: true,
        hideWhen: !scheduled,
        hideRecurrence: true,
        hideAlarms: true,
        hideShowAs: true,
        hideInvitees: !scheduled,
        hideNotes: !scheduled,
        meetCopyOnly: true,
      }}
      afterMeetAccessory={
        mode === "create" ? (
          <Card className="calendar-event-dialog__card meet-create-meeting-dialog__schedule">
            <CardRow title={meetLabels.scheduleMeeting}>
              <Switch
                checked={scheduled}
                onCheckedChange={(checked) => {
                  const next = checked === true;
                  setScheduled(next);
                  if (!next) setForm(applyInstantTimes);
                }}
                aria-label={meetLabels.scheduleMeeting}
                disabled={busy}
              />
            </CardRow>
          </Card>
        ) : undefined
      }
      meetOperations={meetOperations}
      workspaceOrigin={workspaceOrigin}
      sessionUsername={sessionUsername}
      sessionEmail={sessionEmail}
      contactCards={contactCards}
      invitees={resolvedInvitees}
      onChange={(next) => {
        formRef.current = next;
        setForm(next);
      }}
      onClose={onClose}
      onSave={handleSave}
      onDelete={mode === "edit" ? onDelete : undefined}
    />
  );
}
