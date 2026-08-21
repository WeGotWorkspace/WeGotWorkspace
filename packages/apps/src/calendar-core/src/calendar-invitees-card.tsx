import { useMemo, useState } from "react";
import { Clock, Crown, Users, type LucideIcon } from "lucide-react";
import { calendarRsvpStatusIcon } from "@/calendar-core/src/calendar-rsvp-actions";
import {
  attendeesIncludeInvitee,
  attendeesReferToSamePerson,
  inviteeAddress,
  isLikelyEmail,
  isSessionInvitee,
  listedInviteeAttendees,
  organizerAttendeeForList,
  type CalendarAttendee,
  type CalendarInvitee,
  type CalendarParticipationStatus,
} from "@/calendar-core/src/calendar-attendees";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { ShareAccessCard } from "@/share-ui/share-access-card";
import { ShareAccessRow } from "@/share-ui/share-access-row";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { SharePrincipalMark } from "@/share-ui/share-principal-mark";
import {
  SharePrincipalSearchDropdown,
  type ShareSearchOption,
} from "@/share-ui/share-principal-search-dropdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/lib/utils";
import "@/share-ui/share-ui.css";
import "@/calendar-core/src/calendar-invitees-card.css";

const EMAIL_OPTION_PREFIX = "email:";

export type CalendarInviteesCardProps = {
  attendees: CalendarAttendee[];
  invitees: CalendarInvitee[];
  labels: CalendarUILabels;
  busy?: boolean;
  canSubmitEmail?: boolean;
  sessionEmail?: string;
  /** Invitee view: hide add/remove. */
  readOnly?: boolean;
  onChange: (attendees: CalendarAttendee[]) => void;
};

function rsvpLabel(
  status: CalendarParticipationStatus,
  labels: CalendarUILabels,
): string | undefined {
  switch (status) {
    case "accepted":
      return labels.eventAttendeesRsvpAccepted;
    case "tentative":
      return labels.eventAttendeesRsvpTentative;
    case "declined":
      return labels.eventAttendeesRsvpDeclined;
    case "delegated":
      return labels.eventAttendeesRsvpDelegated;
    case "needs-action":
      return labels.eventAttendeesRsvpNeedsAction;
    default:
      return undefined;
  }
}

function rsvpToneClass(status: CalendarParticipationStatus): string | undefined {
  switch (status) {
    case "accepted":
      return "calendar-invitees-rsvp-tag--accepted";
    case "tentative":
      return "calendar-invitees-rsvp-tag--tentative";
    case "declined":
      return "calendar-invitees-rsvp-tag--declined";
    case "delegated":
      return "calendar-invitees-status-mark--delegated";
    case "needs-action":
      return "calendar-invitees-status-mark--pending";
    default:
      return undefined;
  }
}

function InviteeStatusMark({
  label,
  icon: Icon,
  toneClass,
}: {
  label: string;
  icon: LucideIcon;
  toneClass?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="calendar-invitees-status-mark-trigger" tabIndex={0} aria-label={label}>
          <SharePrincipalMark
            principalType="user"
            displayName={label}
            icon={<Icon aria-hidden />}
            className={cn("calendar-invitees-status-mark", toneClass)}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function CalendarInviteesCard({
  attendees,
  invitees,
  labels,
  busy = false,
  canSubmitEmail = true,
  sessionEmail,
  readOnly = false,
  onChange,
}: CalendarInviteesCardProps) {
  const locked = busy || readOnly;
  const [query, setQuery] = useState("");
  const organizer = organizerAttendeeForList(attendees, invitees, sessionEmail);
  const listed = listedInviteeAttendees(attendees, invitees);

  const selectableInvitees = useMemo(
    () =>
      invitees.filter(
        (invitee) =>
          !isSessionInvitee(invitee, sessionEmail) && !attendeesIncludeInvitee(attendees, invitee),
      ),
    [attendees, invitees, sessionEmail],
  );

  const searchResults = useMemo(() => {
    const trimmed = query.trim();
    const needle = trimmed.toLowerCase();
    const teammates: ShareSearchOption[] = selectableInvitees
      .filter((invitee) => {
        if (!needle) return false;
        return (
          invitee.name.toLowerCase().includes(needle) ||
          invitee.username.toLowerCase().includes(needle) ||
          invitee.email.toLowerCase().includes(needle)
        );
      })
      .map((invitee) => ({
        id: inviteeAddress(invitee),
        displayName: invitee.name,
        principalType: "user" as const,
        meta: invitee.username || invitee.email,
      }));

    if (
      isLikelyEmail(trimmed) &&
      !attendees.some((row) =>
        attendeesReferToSamePerson(row, { email: trimmed.toLowerCase() }, invitees),
      )
    ) {
      teammates.push({
        id: `${EMAIL_OPTION_PREFIX}${trimmed.toLowerCase()}`,
        displayName: trimmed.toLowerCase(),
        principalType: "user",
        meta: labels.eventAttendeesEmailAdd,
      });
    }
    return teammates;
  }, [attendees, invitees, labels.eventAttendeesEmailAdd, query, selectableInvitees]);

  const addAttendee = (next: CalendarAttendee) => {
    if (attendees.some((row) => attendeesReferToSamePerson(row, next, invitees))) return;
    onChange([...attendees, next]);
    setQuery("");
  };

  const addTeammate = (invitee: CalendarInvitee) => {
    addAttendee({
      email: inviteeAddress(invitee),
      name: invitee.name,
      participationStatus: "needs-action",
      role: "required",
    });
  };

  const addExternalEmail = (rawEmail: string) => {
    const email = rawEmail.trim().toLowerCase();
    if (!isLikelyEmail(email)) return;
    addAttendee({
      email,
      name: email,
      participationStatus: "needs-action",
      role: "required",
    });
  };

  const selectSearchOption = (option: ShareSearchOption) => {
    if (option.id.startsWith(EMAIL_OPTION_PREFIX)) {
      addExternalEmail(option.id.slice(EMAIL_OPTION_PREFIX.length));
      return;
    }
    const invitee = selectableInvitees.find((row) => inviteeAddress(row) === option.id);
    if (invitee) addTeammate(invitee);
  };

  return (
    <ShareAccessCard
      className="calendar-event-dialog__card calendar-invitees-card"
      titleIcon={<Users className="size-4" />}
      title={labels.eventAttendeesLabel}
      description={labels.eventAttendeesHint}
      footer={
        !readOnly && !canSubmitEmail ? (
          <p className="share-access-card__hint">{labels.eventAttendeesEmailUnavailable}</p>
        ) : null
      }
      addControl={
        readOnly ? undefined : (
          <SharePrincipalSearchDropdown
            query={query}
            results={searchResults}
            emptyLabel={labels.eventAttendeesSearchEmpty}
            listLabel={labels.eventAttendeesLabel}
            minQueryLength={1}
            onSelect={selectSearchOption}
          >
            <ShareDialogInput
              value={query}
              disabled={locked}
              placeholder={labels.eventAttendeesEmailPlaceholder}
              aria-label={labels.eventAttendeesAdd}
              className="share-dialog__add-grant-input"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (isLikelyEmail(query)) addExternalEmail(query);
              }}
            />
          </SharePrincipalSearchDropdown>
        )
      }
    >
      {organizer ? (
        <ShareAccessRow
          key={`organizer:${organizer.email}`}
          mark={
            <InviteeStatusMark
              label={labels.eventAttendeesOrganizer}
              icon={Crown}
              toneClass="calendar-invitees-status-mark--organizer"
            />
          }
          title={organizer.name || organizer.email}
          showRemove={!readOnly}
          removeDisabled
          removeLabel={labels.eventAttendeesRemove}
        />
      ) : null}
      {listed.map((attendee) => {
        const title = attendee.name || attendee.email;
        const status =
          rsvpLabel(attendee.participationStatus, labels) ?? labels.eventAttendeesRsvpNeedsAction;
        const toneClass = rsvpToneClass(attendee.participationStatus);
        const StatusIcon = calendarRsvpStatusIcon(attendee.participationStatus) ?? Clock;

        return (
          <ShareAccessRow
            key={attendee.email}
            mark={<InviteeStatusMark label={status} icon={StatusIcon} toneClass={toneClass} />}
            title={title}
            removeLabel={labels.eventAttendeesRemove}
            removeDisabled={locked}
            onRemove={
              readOnly
                ? undefined
                : () =>
                    onChange(
                      attendees.filter(
                        (row) => !attendeesReferToSamePerson(row, attendee, invitees),
                      ),
                    )
            }
          />
        );
      })}
    </ShareAccessCard>
  );
}
