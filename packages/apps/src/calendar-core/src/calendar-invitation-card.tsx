import { createElement, useEffect, useState } from "react";
import {
  CalendarEventCalendarPicker,
  defaultPickerCalendarId,
  writableCalendarsForPicker,
} from "@/calendar-core/src/calendar-event-calendar-picker";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { normalizeParticipationStatus } from "@/calendar-core/src/calendar-attendees";
import { CalendarRsvpActions } from "@/calendar-core/src/calendar-rsvp-actions";
import {
  canRespondInvitation,
  invitationToEventCardFields,
} from "@/calendar-core/src/calendar-invitation-event";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type {
  CalendarSchedulingNotification,
  CalendarSchedulingRespondStatus,
} from "@/lib/api/wgw/calendar-scheduling";
import {
  DocsCollabCardHeader,
  DocsCollabCardShell,
  useDocsCollabCardExit,
} from "@/text-editor-core/docs-collab/docs-collab-card";
import "@/lib/calendar-elements/EventCard/EventCard";
import "./calendar-invitation-card.css";

const INVITATION_EXIT_ANIMATION = "docs-comments-thread-card-evaporate";

export type CalendarInvitationCardProps = {
  notification: CalendarSchedulingNotification;
  labels: CalendarUILabels;
  locale: string;
  calendars: CalendarInfo[];
  defaultCalendarId?: string;
  active: boolean;
  busy?: boolean;
  onSelect: () => void;
  onRespond: (status: CalendarSchedulingRespondStatus, calendarId?: string) => void | Promise<void>;
};

export function CalendarInvitationCard({
  notification,
  labels,
  locale,
  calendars,
  defaultCalendarId,
  active,
  busy = false,
  onSelect,
  onRespond,
}: CalendarInvitationCardProps) {
  const { cardRef, isExiting, handleExitAnimationEnd } = useDocsCollabCardExit({
    exitAnimationName: INVITATION_EXIT_ANIMATION,
  });
  const organizer =
    notification.organizerName || notification.organizerEmail || labels.invitationsOrganizerUnknown;
  const canRespond = canRespondInvitation(notification);
  const showCalendarPicker =
    canRespond && normalizeParticipationStatus(notification.participationStatus) === "needs-action";
  const currentStatus = normalizeParticipationStatus(notification.participationStatus);
  const eventCard = invitationToEventCardFields(notification, labels, locale);
  const [calendarId, setCalendarId] = useState(() =>
    defaultPickerCalendarId(calendars, defaultCalendarId),
  );

  useEffect(() => {
    setCalendarId((current) => {
      const writable = writableCalendarsForPicker(calendars);
      if (current && writable.some((calendar) => calendar.id === current)) {
        return current;
      }
      return defaultPickerCalendarId(calendars, defaultCalendarId);
    });
  }, [calendars, defaultCalendarId]);

  const respond = (status: CalendarSchedulingRespondStatus) =>
    onRespond(status, status === "declined" ? undefined : calendarId || undefined);

  return (
    <DocsCollabCardShell
      cardRef={cardRef}
      className="calendar-invitation-card"
      exitVariant="comment"
      active={active}
      isExiting={isExiting}
      onSelect={onSelect}
      onAnimationEnd={handleExitAnimationEnd}
      dataAttributes={{ "data-invitation-id": notification.id }}
    >
      <DocsCollabCardHeader
        authorName={organizer}
        actions={
          showCalendarPicker ? (
            <div
              className="calendar-invitation-card__calendar"
              onClick={(event) => event.stopPropagation()}
            >
              <CalendarEventCalendarPicker
                calendars={calendars}
                calendarId={calendarId}
                labels={labels}
                disabled={busy}
                triggerClassName="calendar-event-dialog__calendar-trigger calendar-invitation-card__calendar-trigger"
                onCalendarIdChange={setCalendarId}
              />
            </div>
          ) : null
        }
      />

      {createElement("event-card", {
        class: "calendar-invitation-card__event",
        layout: "flow",
        lang: locale,
        summary: eventCard.summary,
        time: eventCard.time,
        location: eventCard.location,
        color: eventCard.color,
        past: eventCard.cancelled,
        recurring: eventCard.recurring,
      })}

      {canRespond ? (
        <div className="calendar-invitation-card__rsvp">
          {eventCard.recurring ? (
            <p className="calendar-invitation-card__rsvp-hint">{labels.rsvpSeriesHint}</p>
          ) : null}
          <CalendarRsvpActions
            className="calendar-invitation-card__actions"
            currentStatus={currentStatus}
            labels={labels}
            busy={busy}
            size="sm"
            onRespond={respond}
          />
        </div>
      ) : null}
    </DocsCollabCardShell>
  );
}
