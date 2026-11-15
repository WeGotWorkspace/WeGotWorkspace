import { useEffect, useId, useMemo, useState } from "react";
import { Users } from "lucide-react";
import {
  attendeesReferToSamePerson,
  inviteeForAttendee,
  listedInviteeAttendees,
  normalizeParticipantAddress,
  organizerAttendeeForList,
  type CalendarAttendee,
  type CalendarInvitee,
  type CalendarParticipationStatus,
} from "@/lib/models/calendar-attendees";
import {
  calendarInviteeSearchRows,
  searchRowToAttendee,
  typedEmailSearchRow,
  type CalendarInviteeContactContext,
  type CalendarInviteeSearchRow,
} from "@/calendar-core/src/calendar-contact-attendee";
import type { InviteeAvailabilityMap } from "@/calendar-core/src/calendar-invitee-availability";
import {
  CalendarInviteeBusyTooltip,
  inviteeBusyRows,
} from "@/calendar-core/src/calendar-invitee-availability-tag";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { useCalendarDisplayPrefs } from "@/calendar-core/src/use-calendar-display-prefs";
import type { ContactCard } from "@/lib/models/contacts-types";
import { ShareAccessCard } from "@/share-ui/share-access-card";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import {
  SharePrincipalSearchDropdown,
  type ShareSearchOption,
} from "@/share-ui/share-principal-search-dropdown";
import { Tag } from "@/tag/src/tag";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import type { ControlSize } from "@/ui/control-size";
import { cn } from "@/lib/utils";
import { noTeamYetCopy } from "@/share-ui/share-labels";
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
  /** The viewer: their own row shows their name and username, like a teammate's. */
  self?: CalendarInvitee;
  contactCards?: ContactCard[];
  /** Invitee view: hide add/remove. */
  readOnly?: boolean;
  /** The viewer is in no Team and has nobody to pick: say so under the field (#1924). */
  noTeam?: boolean;
  /** Persistent warning when email guests cannot join a channel Meet. */
  meetEmailGuestHint?: string;
  /** `field` matches the flat event-form FieldLabelRow chrome. */
  presentation?: "card" | "field";
  className?: string;
  /** Shared control height for the add-invitee input. Default `md`. */
  controlSize?: ControlSize;
  onChange: (attendees: CalendarAttendee[]) => void;
  /** Live JMAP refresh; cache remains the first paint. */
  onRefreshContactCards?: () => void;
  /**
   * Free/Busy per invited teammate (#1614), keyed by normalized address. Busy washes that
   * person's tag in the warning colour; free or no entry leaves the tag as it is.
   */
  availability?: InviteeAvailabilityMap;
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

type ParticipantTagProps = {
  attendee: Pick<CalendarAttendee, "email" | "name">;
  invitees: CalendarInvitee[];
  statusLabel: string;
  toneClass?: string;
  removeLabel: string;
  onRemove?: () => void;
  /** Overlapping periods when this teammate is busy at the event's time (#1614). */
  busyRows?: string[] | null;
  labels: CalendarUILabels;
};

/**
 * A participant as a tag: the name (an outside guest's email), the RSVP as the tag's dot
 * and wash and as its tooltip, with any busy time under it.
 */
function ParticipantTag({
  attendee,
  invitees,
  statusLabel,
  toneClass,
  removeLabel,
  onRemove,
  busyRows,
  labels,
}: ParticipantTagProps) {
  const teammate = inviteeForAttendee(attendee, invitees);
  const name = teammate?.name || attendee.name;
  const handle = teammate ? teammate.username : attendee.email;
  const label = name || handle;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="calendar-invitees-card__tag"
          tabIndex={0}
          // A screen reader hears the clash too, not only the tooltip's sighted users.
          aria-label={[label, statusLabel, busyRows && labels.eventAttendeesAvailabilityBusyWith]
            .filter(Boolean)
            .join(", ")}
        >
          <Tag
            label={label}
            className={cn(toneClass, busyRows && "calendar-invitees-card__tag--busy")}
            dot
            size="lg"
            removable={Boolean(onRemove)}
            onRemove={onRemove}
            removeAriaLabel={`${removeLabel}: ${label}`}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {busyRows ? (
          <CalendarInviteeBusyTooltip rsvpLabel={statusLabel} rows={busyRows} labels={labels} />
        ) : (
          statusLabel
        )}
      </TooltipContent>
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
  self,
  contactCards = [],
  readOnly = false,
  noTeam = false,
  meetEmailGuestHint,
  presentation = "card",
  className,
  controlSize = "sm",
  onChange,
  onRefreshContactCards,
  availability,
}: CalendarInviteesCardProps) {
  const locked = busy || readOnly;
  const addFieldId = useId();
  const { locale, timeZone } = useCalendarDisplayPrefs();
  const [query, setQuery] = useState("");
  const organizer = organizerAttendeeForList(attendees, invitees, sessionEmail);
  const listed = listedInviteeAttendees(attendees, invitees);
  const people = useMemo(() => (self ? [...invitees, self] : invitees), [invitees, self]);

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

  const showNoTeam = !readOnly && noTeam;

  const addControl = readOnly ? undefined : (
    <SharePrincipalSearchDropdown
      query={query}
      results={searchResults}
      emptyLabel={showNoTeam ? noTeamYetCopy : labels.eventAttendeesSearchEmpty}
      listLabel={labels.eventAttendeesLabel}
      minQueryLength={1}
      onSelect={selectSearchOption}
    >
      <ShareDialogInput
        id={addFieldId}
        value={query}
        size={controlSize}
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
  );

  // The card states the no-Team sentence as its description; the flat field has none.
  const footerNoTeam = showNoTeam && presentation === "field";
  const footer =
    (!readOnly && !canSubmitEmail) || footerNoTeam || meetEmailGuestHint ? (
      <>
        {!readOnly && !canSubmitEmail ? (
          <p className="share-access-card__hint">{labels.eventAttendeesEmailUnavailable}</p>
        ) : null}
        {footerNoTeam ? <p className="share-access-card__hint">{noTeamYetCopy}</p> : null}
        {meetEmailGuestHint && !(footerNoTeam || (!readOnly && !canSubmitEmail)) ? (
          <p className="share-access-card__hint calendar-invitees-card__meet-email-hint">
            {meetEmailGuestHint}
          </p>
        ) : null}
      </>
    ) : null;

  const participants = (
    <>
      {organizer ? (
        <ParticipantTag
          key={`organizer:${organizer.email}`}
          attendee={organizer}
          invitees={people}
          statusLabel={labels.eventAttendeesOrganizer}
          toneClass="calendar-invitees-status-mark--organizer"
          removeLabel={labels.eventAttendeesRemove}
          labels={labels}
        />
      ) : null}
      {listed.map((attendee) => {
        const status =
          rsvpLabel(attendee.participationStatus, labels) ?? labels.eventAttendeesRsvpNeedsAction;
        const busyRows = inviteeBusyRows(
          availability?.get(normalizeParticipantAddress(attendee.email)),
          { labels, locale, timeZone },
        );

        return (
          <ParticipantTag
            key={attendee.email}
            attendee={attendee}
            invitees={people}
            statusLabel={status}
            toneClass={rsvpToneClass(attendee.participationStatus)}
            removeLabel={labels.eventAttendeesRemove}
            onRemove={
              locked
                ? undefined
                : () =>
                    onChange(
                      attendees.filter(
                        (row) => !attendeesReferToSamePerson(row, attendee, invitees),
                      ),
                    )
            }
            busyRows={busyRows}
            labels={labels}
          />
        );
      })}
    </>
  );

  // A section like Team access in the Share dialog: the add field first, then the people.
  return (
    <ShareAccessCard
      icon={<Users aria-hidden />}
      htmlFor={addControl != null ? addFieldId : undefined}
      className={cn(
        "calendar-invitees-card",
        presentation === "field" ? "calendar-invitees-card--field" : "calendar-event-dialog__card",
        className,
      )}
      title={labels.eventAttendeesLabel}
      description={
        presentation === "field"
          ? undefined
          : showNoTeam
            ? noTeamYetCopy
            : labels.eventAttendeesHint
      }
      footer={footer}
      addControl={addControl}
    >
      <div className="calendar-invitees-card__tags">{participants}</div>
    </ShareAccessCard>
  );
}
