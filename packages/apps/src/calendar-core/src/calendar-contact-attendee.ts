import {
  attendeesReferToSamePerson,
  calendarSessionOwnsAddress,
  inviteeAddress,
  isLikelyEmail,
  isSessionInvitee,
  normalizeParticipantAddress,
  type CalendarAttendee,
  type CalendarInvitee,
} from "@/calendar-core/src/calendar-attendees";
import {
  contactDisplayName,
  filterCardsBySearch,
  mapEntriesSorted,
} from "@/contacts-core/src/contacts-display-utils";
import { isContactGroupCard } from "@/contacts-core/src/contacts-group-utils";
import type { ContactCard } from "@/contacts-core/src/contacts-types";

export type CalendarInviteeSearchSource = "teammate" | "contact" | "typed-email";

export type CalendarInviteeContactContext = "work" | "home" | "school";

export type CalendarInviteeSearchRow = {
  id: string;
  displayName: string;
  email: string;
  rawEmail: string;
  source: CalendarInviteeSearchSource;
  contactContext?: CalendarInviteeContactContext;
  username?: string;
};

export type ContactInviteEmail = {
  email: string;
  rawEmail: string;
  contactContext?: CalendarInviteeContactContext;
};

export function stripMailtoKeepCasing(value: string): string {
  const trimmed = value.trim();
  return /^mailto:/i.test(trimmed) ? trimmed.slice(trimmed.indexOf(":") + 1).trim() : trimmed;
}

/** First-match priority: work wins over home over school. */
function contactContextFromMap(
  contexts?: Record<string, boolean | undefined>,
): CalendarInviteeContactContext | undefined {
  if (contexts?.work) return "work";
  if (contexts?.home) return "home";
  if (contexts?.school) return "school";
  return undefined;
}

export function findInviteeForAddress(
  address: string,
  invitees: CalendarInvitee[],
): CalendarInvitee | undefined {
  return invitees.find((invitee) =>
    attendeesReferToSamePerson({ email: address }, { email: inviteeAddress(invitee) }, [invitee]),
  );
}

export function teammateSearchRow(invitee: CalendarInvitee): CalendarInviteeSearchRow {
  const rawEmail = inviteeAddress(invitee);
  const email = normalizeParticipantAddress(rawEmail);
  return {
    id: `teammate:${email}`,
    displayName: invitee.name,
    email,
    rawEmail,
    source: "teammate",
    username: invitee.username,
  };
}

export function typedEmailSearchRow(input: string): CalendarInviteeSearchRow | null {
  const rawEmail = stripMailtoKeepCasing(input);
  const email = normalizeParticipantAddress(rawEmail);
  if (!email || !isLikelyEmail(rawEmail)) return null;
  return {
    id: `typed-email:${email}`,
    displayName: rawEmail,
    email,
    rawEmail,
    source: "typed-email",
  };
}

export function contactInviteEmails(card: ContactCard): ContactInviteEmail[] {
  if (isContactGroupCard(card)) return [];

  const seen = new Set<string>();
  const rows: ContactInviteEmail[] = [];

  const pushAddress = (rawValue: string, contexts?: Record<string, boolean | undefined>) => {
    const rawEmail = stripMailtoKeepCasing(rawValue);
    const email = normalizeParticipantAddress(rawEmail);
    if (!email || seen.has(email)) return;
    seen.add(email);
    rows.push({
      email,
      rawEmail,
      contactContext: contactContextFromMap(contexts),
    });
  };

  for (const [, entry] of mapEntriesSorted(card.emails)) {
    pushAddress(entry.address ?? "", entry.contexts);
  }

  for (const [, entry] of mapEntriesSorted(card.schedulingAddresses)) {
    const uri = typeof entry.uri === "string" ? entry.uri : "";
    if (!/^mailto:/i.test(uri.trim())) continue;
    pushAddress(uri, entry.contexts);
  }

  return rows;
}

export function explodeContactInviteeSearchRows(card: ContactCard): CalendarInviteeSearchRow[] {
  const displayName = contactDisplayName(card);
  return contactInviteEmails(card).map((row) => ({
    id: `contact:${card.id}:${row.email}`,
    displayName,
    email: row.email,
    rawEmail: row.rawEmail,
    source: "contact" as const,
    contactContext: row.contactContext,
  }));
}

export function contactEmailToAttendee(
  row: Pick<CalendarInviteeSearchRow, "email" | "rawEmail" | "displayName">,
  invitees: CalendarInvitee[],
): CalendarAttendee {
  const invitee = findInviteeForAddress(row.email, invitees);
  return {
    email: invitee ? inviteeAddress(invitee) : row.rawEmail,
    name: invitee?.name.trim() || row.displayName,
    participationStatus: "needs-action",
    role: "required",
  };
}

export const searchRowToAttendee = contactEmailToAttendee;

function teammateHaystack(invitee: CalendarInvitee): string {
  return [invitee.name, invitee.username, invitee.email, inviteeAddress(invitee)]
    .filter((value): value is string => typeof value === "string" && value !== "")
    .map((value) => value.toLowerCase())
    .join("\0");
}

function teammateMatchesQuery(invitee: CalendarInvitee, needle: string): boolean {
  if (teammateHaystack(invitee).includes(needle)) return true;
  return normalizeParticipantAddress(inviteeAddress(invitee)).includes(needle);
}

function selectableInviteeForAddress(
  address: string,
  selectable: CalendarInvitee[],
): CalendarInvitee | undefined {
  return selectable.find((invitee) =>
    attendeesReferToSamePerson({ email: address }, { email: inviteeAddress(invitee) }, [invitee]),
  );
}

function shouldOmitContactRow(
  row: CalendarInviteeSearchRow,
  attendees: CalendarAttendee[],
  invitees: CalendarInvitee[],
  sessionEmail?: string,
): boolean {
  if (findInviteeForAddress(row.email, invitees)) return true;
  if (
    attendees.some((attendee) =>
      attendeesReferToSamePerson(attendee, { email: row.email }, invitees),
    )
  ) {
    return true;
  }
  const session = sessionEmail?.trim();
  if (session && calendarSessionOwnsAddress(row.email, [session])) return true;
  return false;
}

export function calendarInviteeSearchRows(input: {
  query: string;
  invitees: CalendarInvitee[];
  attendees: CalendarAttendee[];
  cards: ContactCard[];
  sessionEmail?: string;
}): CalendarInviteeSearchRow[] {
  const trimmed = input.query.trim();
  const needle = trimmed.toLowerCase();
  if (!needle) return [];

  const selectableInvitees = input.invitees.filter(
    (invitee) =>
      !isSessionInvitee(invitee, input.sessionEmail) &&
      !input.attendees.some((attendee) =>
        attendeesReferToSamePerson(attendee, { email: inviteeAddress(invitee) }, [invitee]),
      ),
  );

  const teammatesByEmail = new Map<string, CalendarInviteeSearchRow>();
  const addTeammate = (invitee: CalendarInvitee) => {
    const row = teammateSearchRow(invitee);
    if (!teammatesByEmail.has(row.email)) teammatesByEmail.set(row.email, row);
  };

  for (const invitee of selectableInvitees) {
    if (teammateMatchesQuery(invitee, needle)) addTeammate(invitee);
  }

  const takenEmails = new Set(teammatesByEmail.keys());
  const contacts: CalendarInviteeSearchRow[] = [];
  for (const card of filterCardsBySearch(input.cards, trimmed)) {
    for (const row of explodeContactInviteeSearchRows(card)) {
      const matchingInvitee = selectableInviteeForAddress(row.email, selectableInvitees);
      if (matchingInvitee) {
        addTeammate(matchingInvitee);
        takenEmails.add(normalizeParticipantAddress(inviteeAddress(matchingInvitee)));
        takenEmails.add(row.email);
        continue;
      }
      if (takenEmails.has(row.email)) continue;
      if (shouldOmitContactRow(row, input.attendees, input.invitees, input.sessionEmail)) continue;
      takenEmails.add(row.email);
      contacts.push(row);
    }
  }

  const rows = [...teammatesByEmail.values(), ...contacts];

  const typed = typedEmailSearchRow(trimmed);
  if (!typed) return rows;
  if (takenEmails.has(typed.email)) return rows;
  if (shouldOmitContactRow(typed, input.attendees, input.invitees, input.sessionEmail)) return rows;
  rows.push(typed);
  return rows;
}
