export type CalendarParticipationStatus =
  | "needs-action"
  | "accepted"
  | "tentative"
  | "declined"
  | "delegated";

export type CalendarAttendeeRole = "required" | "optional";

export type CalendarAttendee = {
  email: string;
  name: string;
  participationStatus: CalendarParticipationStatus;
  /** Required → JMAP `attendee` / ICS REQ-PARTICIPANT. Optional → `optional` / OPT-PARTICIPANT. */
  role?: CalendarAttendeeRole;
  isOrganizer?: boolean;
};

export type CalendarInvitee = {
  username: string;
  email: string;
  name: string;
};

export type JmapParticipant = {
  "@type"?: "Participant";
  email?: string;
  name?: string;
  roles?: Record<string, boolean> | string[];
  participationStatus?: string;
  expectReply?: boolean;
  sendTo?: { imip?: string };
};

function participantRoleIds(roles: JmapParticipant["roles"]): string[] {
  if (!roles) return [];
  if (Array.isArray(roles)) {
    return roles.filter((role): role is string => typeof role === "string" && role !== "");
  }
  return Object.entries(roles)
    .filter(([, enabled]) => enabled === true)
    .map(([role]) => role);
}

export function attendeeRoleFromRoles(roles: JmapParticipant["roles"]): CalendarAttendeeRole {
  return participantRoleIds(roles).includes("optional") ? "optional" : "required";
}

export function jmapRolesForAttendee(
  role: CalendarAttendeeRole | undefined,
): Record<string, boolean> {
  return role === "optional" ? { optional: true } : { attendee: true };
}

export function inviteeAddress(invitee: CalendarInvitee): string {
  return invitee.email || invitee.username;
}

export function normalizeParticipantAddress(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("mailto:") ? trimmed.slice(7) : trimmed;
}

function inviteeAliases(invitee: CalendarInvitee): string[] {
  return [invitee.email, invitee.username]
    .map((value) => normalizeParticipantAddress(value))
    .filter(Boolean);
}

export function attendeeIdentityKeys(
  attendee: Pick<CalendarAttendee, "email">,
  invitees: CalendarInvitee[] = [],
): string[] {
  const email = normalizeParticipantAddress(attendee.email);
  const keys = new Set<string>();
  if (email) keys.add(email);
  for (const invitee of invitees) {
    const aliases = inviteeAliases(invitee);
    if (aliases.includes(email)) {
      for (const alias of aliases) keys.add(alias);
    }
  }
  return [...keys];
}

export function attendeesReferToSamePerson(
  left: Pick<CalendarAttendee, "email">,
  right: Pick<CalendarAttendee, "email">,
  invitees: CalendarInvitee[] = [],
): boolean {
  const rightKeys = new Set(attendeeIdentityKeys(right, invitees));
  return attendeeIdentityKeys(left, invitees).some((key) => rightKeys.has(key));
}

export function attendeesIncludeInvitee(
  attendees: CalendarAttendee[],
  invitee: CalendarInvitee,
): boolean {
  return attendees.some((row) =>
    attendeesReferToSamePerson(row, { email: inviteeAddress(invitee) }, [invitee]),
  );
}

export function isSessionInvitee(invitee: CalendarInvitee, sessionEmail?: string): boolean {
  const self = sessionEmail?.trim();
  if (!self) return false;
  return attendeesReferToSamePerson({ email: self }, { email: inviteeAddress(invitee) }, [invitee]);
}

/** Attendees shown in the Invitees card: not the organizer, one row per person. */
export function listedInviteeAttendees(
  attendees: CalendarAttendee[],
  invitees: CalendarInvitee[] = [],
): CalendarAttendee[] {
  const organizer = attendees.find((row) => row.isOrganizer);
  const listed: CalendarAttendee[] = [];
  for (const row of attendees) {
    if (row.isOrganizer) continue;
    if (organizer && attendeesReferToSamePerson(row, organizer, invitees)) continue;
    if (listed.some((existing) => attendeesReferToSamePerson(existing, row, invitees))) continue;
    listed.push(row);
  }
  return listed;
}

function mergeAttendeeDuplicate(
  current: CalendarAttendee,
  incoming: CalendarAttendee,
): CalendarAttendee {
  const preferIncomingEmail = isLikelyEmail(incoming.email) && !isLikelyEmail(current.email);
  return {
    email: preferIncomingEmail ? incoming.email : current.email,
    name:
      current.name && current.name !== current.email ? current.name : incoming.name || current.name,
    participationStatus:
      current.participationStatus === "needs-action"
        ? incoming.participationStatus
        : current.participationStatus,
    role: incoming.role === "optional" || current.role === "optional" ? "optional" : "required",
    isOrganizer: Boolean(current.isOrganizer || incoming.isOrganizer),
  };
}

function emailFromParticipant(participant: JmapParticipant): string {
  return normalizeParticipantAddress(participant.email ?? participant.sendTo?.imip ?? "");
}

export function attendeesFromParticipants(
  participants: Record<string, JmapParticipant> | undefined,
): CalendarAttendee[] {
  if (!participants) return [];
  const attendees: CalendarAttendee[] = [];
  for (const participant of Object.values(participants)) {
    const email = emailFromParticipant(participant);
    if (!email) continue;
    const roles = participant.roles;
    const next: CalendarAttendee = {
      email,
      name: participant.name?.trim() || email,
      participationStatus: normalizeParticipationStatus(participant.participationStatus),
      role: attendeeRoleFromRoles(roles),
      isOrganizer: participantRoleIds(roles).includes("owner"),
    };
    const existingIndex = attendees.findIndex((row) => attendeesReferToSamePerson(row, next));
    if (existingIndex >= 0) {
      attendees[existingIndex] = mergeAttendeeDuplicate(attendees[existingIndex]!, next);
      continue;
    }
    attendees.push(next);
  }
  return attendees;
}

export function participantsFromAttendees(
  attendees: CalendarAttendee[],
  organizer?: { email: string; name?: string },
): Record<string, JmapParticipant> | undefined {
  const map: Record<string, JmapParticipant> = {};
  const organizerEmail = organizer?.email.trim().toLowerCase() ?? "";
  if (organizerEmail) {
    map.org = {
      "@type": "Participant",
      email: organizerEmail,
      name: organizer?.name?.trim() || organizerEmail,
      roles: { owner: true },
      participationStatus: "accepted",
    };
  }
  let index = 0;
  const seen = new Set<string>(organizerEmail ? [organizerEmail] : []);
  for (const attendee of attendees) {
    if (attendee.isOrganizer) continue;
    const email = normalizeParticipantAddress(attendee.email);
    if (!email || seen.has(email) || email === organizerEmail) continue;
    seen.add(email);
    map[`att${++index}`] = {
      "@type": "Participant",
      email,
      name: attendee.name.trim() || email,
      roles: jmapRolesForAttendee(attendee.role),
      expectReply: true,
      participationStatus: attendee.participationStatus,
    };
  }
  return Object.keys(map).length ? map : undefined;
}

export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}

export function organizerAddress(session: {
  email?: string;
  username?: string;
  displayName?: string;
}): { email: string; name?: string } | undefined {
  const email = session.email?.trim() || session.username?.trim() || "";
  if (!email) return undefined;
  return { email, name: session.displayName?.trim() || email };
}

export function attendeesEqual(a: CalendarAttendee[], b: CalendarAttendee[]): boolean {
  if (a.length !== b.length) return false;
  const key = (attendee: CalendarAttendee) =>
    `${attendee.email.toLowerCase()}:${attendee.participationStatus}:${attendee.role ?? "required"}:${attendee.isOrganizer ? "1" : "0"}`;
  const left = [...a].map(key).sort();
  const right = [...b].map(key).sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Current user's RSVP on a wire event. Organizer-owned events (or no self attendee)
 * return null so the grid keeps the solid calendar color.
 */
export function ownEventRsvpPresentation(
  participants: Record<string, JmapParticipant> | undefined,
  sessionEmail?: string,
): CalendarParticipationStatus | null {
  const selfEmail = sessionEmail?.trim();
  if (!selfEmail) return null;
  const self = attendeesFromParticipants(participants).find((row) =>
    attendeesReferToSamePerson(row, { email: selfEmail }),
  );
  if (!self || self.isOrganizer) return null;
  return self.participationStatus;
}

export function eventCardRsvpAttr(
  status: CalendarParticipationStatus | null | undefined,
): "needs-action" | "tentative" | "" {
  if (status === "needs-action" || status === "tentative") return status;
  return "";
}

export function normalizeParticipationStatus(
  value: string | undefined,
): CalendarParticipationStatus {
  switch ((value ?? "").trim().toLowerCase().replace("_", "-")) {
    case "accepted":
      return "accepted";
    case "tentative":
      return "tentative";
    case "declined":
      return "declined";
    case "delegated":
      return "delegated";
    default:
      return "needs-action";
  }
}
