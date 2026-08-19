import { createElement, useState } from "react";
import { Check, CircleHelp, X } from "lucide-react";
import {
  CalendarEventCalendarPicker,
  defaultPickerCalendarId,
} from "@/calendar-core/src/calendar-event-calendar-picker";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { normalizeParticipationStatus } from "@/calendar-core/src/calendar-attendees";
import { cn } from "@/lib/utils";
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

function rsvpActionClass(kind: "accept" | "maybe" | "decline", selected: boolean): string {
  return cn(
    "calendar-invitation-card__action",
    `calendar-invitation-card__action--${kind}`,
    selected && "calendar-invitation-card__action--selected",
  );
}

export type CalendarInvitationCardProps = {
  notification: CalendarSchedulingNotification;
  labels: CalendarUILabels;
  locale: string;
  calendars: CalendarInfo[];
  defaultCalendarId?: string;
  active: boolean;
  busy?: boolean;
  onSelect: () => void;
  onRespond: (status: CalendarSchedulingRespondStatus, calendarId?: string) => void;
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
  const { cardRef, isExiting, runExitAnimation, handleExitAnimationEnd } = useDocsCollabCardExit({
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

  const respond = (status: CalendarSchedulingRespondStatus) => {
    const apply = () =>
      onRespond(status, status === "declined" ? undefined : calendarId || undefined);
    if (currentStatus === "needs-action") {
      runExitAnimation(apply);
      return;
    }
    apply();
  };

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
        <div className="calendar-invitation-card__actions">
          <button
            type="button"
            className={rsvpActionClass("accept", currentStatus === "accepted")}
            aria-pressed={currentStatus === "accepted"}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              respond("accepted");
            }}
          >
            <Check className="calendar-invitation-card__action-icon" aria-hidden />
            {labels.rsvpAccept}
          </button>
          <button
            type="button"
            className={rsvpActionClass("maybe", currentStatus === "tentative")}
            aria-pressed={currentStatus === "tentative"}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              respond("tentative");
            }}
          >
            <CircleHelp className="calendar-invitation-card__action-icon" aria-hidden />
            {labels.rsvpMaybe}
          </button>
          <button
            type="button"
            className={rsvpActionClass("decline", currentStatus === "declined")}
            aria-pressed={currentStatus === "declined"}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              respond("declined");
            }}
          >
            <X className="calendar-invitation-card__action-icon" aria-hidden />
            {labels.rsvpDecline}
          </button>
        </div>
      ) : null}
    </DocsCollabCardShell>
  );
}
