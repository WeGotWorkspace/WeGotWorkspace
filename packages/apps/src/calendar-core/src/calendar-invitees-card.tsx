import { useEffect, useMemo, useState } from "react";
import { Clock, Crown, Users, type LucideIcon } from "lucide-react";
import { calendarRsvpStatusIcon } from "@/calendar-core/src/calendar-rsvp-actions";
import {
  attendeesReferToSamePerson,
  listedInviteeAttendees,
  organizerAttendeeForList,
  type CalendarAttendee,
  type CalendarInvitee,
  type CalendarParticipationStatus,
} from "@/calendar-core/src/calendar-attendees";
import {
  calendarInviteeSearchRows,
  searchRowToAttendee,
  typedEmailSearchRow,
  type CalendarInviteeContactContext,
  type CalendarInviteeSearchRow,
} from "@/calendar-core/src/calendar-contact-attendee";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
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

/** Same delay as calendar share principal search. */
export const CALENDAR_CONTACT_INVITEE_REFRESH_MS = 250;

export type CalendarInviteesCardProps = {
  attendees: CalendarAttendee[];
  invitees: CalendarInvitee[];
  labels: CalendarUILabels;
  busy?: boolean;
  canSubmitEmail?: boolean;
  sessionEmail?: string;
  contactCards?: ContactCard[];
  /** Invitee view: hide add/remove. */
  readOnly?: boolean;
  onChange: (attendees: CalendarAttendee[]) => void;
  /** Live JMAP refresh; cache remains the first paint. */
  onRefreshContactCards?: () => void;
};

function contactContextLabel(
  context: CalendarInviteeContactContext | undefined,
  labels: CalendarUILabels,
): string | undefined {
  if (context === "work") return labels.eventAttendeesContactWork;
  if (context === "home") return labels.eventAttendeesContactHome;
  if (context === "school") return labels.eventAttendeesContactSchool;
  return undefined;
}

export function inviteeSearchRowMeta(
  row: CalendarInviteeSearchRow,
  labels: CalendarUILabels,
): string {
  if (row.source === "teammate") return labels.eventAttendeesTeammate;
  if (row.source === "typed-email") return labels.eventAttendeesEmailAdd;
  const context = contactContextLabel(row.contactContext, labels);
  return context ? `${row.rawEmail} · ${context}` : row.rawEmail;
}

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
  contactCards = [],
  readOnly = false,
  onChange,
  onRefreshContactCards,
}: CalendarInviteesCardProps) {
  const locked = busy || readOnly;
  const [query, setQuery] = useState("");
  const organizer = organizerAttendeeForList(attendees, invitees, sessionEmail);
  const listed = listedInviteeAttendees(attendees, invitees);

  useEffect(() => {
    if (readOnly || !onRefreshContactCards || !query.trim()) return;
    const timer = window.setTimeout(() => {
      onRefreshContactCards();
    }, CALENDAR_CONTACT_INVITEE_REFRESH_MS);
    return () => window.clearTimeout(timer);
  }, [onRefreshContactCards, query, readOnly]);

  const searchRows = useMemo(
    () =>
      calendarInviteeSearchRows({
        query,
        invitees,
        attendees,
        cards: contactCards,
        sessionEmail,
      }),
    [attendees, contactCards, invitees, query, sessionEmail],
  );

  const searchResults = useMemo<ShareSearchOption[]>(
    () =>
      searchRows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        principalType: "user",
        meta: inviteeSearchRowMeta(row, labels),
      })),
    [labels, searchRows],
  );

  const addAttendee = (next: CalendarAttendee) => {
    if (attendees.some((row) => attendeesReferToSamePerson(row, next, invitees))) return;
    onChange([...attendees, next]);
    setQuery("");
  };

  const selectSearchRow = (row: CalendarInviteeSearchRow) => {
    addAttendee(searchRowToAttendee(row, invitees));
  };

  const selectSearchOption = (option: ShareSearchOption) => {
    const row = searchRows.find((entry) => entry.id === option.id);
    if (row) selectSearchRow(row);
  };

  const addTypedEmail = (value: string) => {
    const row = typedEmailSearchRow(value);
    if (row) selectSearchRow(row);
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
                addTypedEmail(query);
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
