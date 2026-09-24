import {
  attendeesReferToSamePerson,
  inviteeAddress,
  listedInviteeAttendees,
  type CalendarAttendee,
  type CalendarInvitee,
} from "@/calendar-core/src/calendar-attendees";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import { parseMeetInvitePath } from "@/calendar-core/src/calendar-meet-link";
import { createMeetRoomCode } from "@/meet-core/src/meet-room-id";
import { buildMeetGuestCallLink } from "@/meet-core/src/meet-route-search";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";

/**
 * Members-only Meet # channel — pathname `/meet/channels/{id}`
 * (`parseMeetInvitePath` `roomKind === "channel"`).
 *
 * Meeting URLs (`/meet/meetings/{id}`, persistent slugs like `test-meet`, and
 * ad-hoc `xxxx-xxxx-xxxx` room codes) allow email invitees and never collide.
 */
export function isCalendarMeetChannelUrl(href: string): boolean {
  return parseMeetInvitePath(href)?.roomKind === "channel";
}

/**
 * Workspace / directory principal. Matching uses the same username↔email
 * aliases as the invitee picker (`attendeesReferToSamePerson`).
 *
 * Heuristic: anyone not in `invitees` is treated as email-only (contacts and
 * typed addresses included). Directory rows with a username and empty email
 * still match teammates added by username.
 */
export function isDirectoryCalendarAttendee(
  attendee: Pick<CalendarAttendee, "email" | "isOrganizer">,
  invitees: CalendarInvitee[],
): boolean {
  if (attendee.isOrganizer) return true;
  return invitees.some((invitee) =>
    attendeesReferToSamePerson(attendee, { email: inviteeAddress(invitee) }, [invitee]),
  );
}

/** Non-organizer attendees whose address is not a workspace directory principal. */
export function emailOnlyCalendarAttendees(
  attendees: CalendarAttendee[],
  invitees: CalendarInvitee[],
): CalendarAttendee[] {
  return listedInviteeAttendees(attendees, invitees).filter(
    (row) => !isDirectoryCalendarAttendee(row, invitees),
  );
}

export function hasMeetChannelEmailCollision(input: {
  meetingUrl: string;
  attendees: CalendarAttendee[];
  invitees: CalendarInvitee[];
}): boolean {
  return (
    isCalendarMeetChannelUrl(input.meetingUrl) &&
    emailOnlyCalendarAttendees(input.attendees, input.invitees).length > 0
  );
}

/**
 * Save-time collision. Meeting-kind create (`/meet/meetings/…`) is not a
 * members-only channel — same rule as {@link hasMeetChannelEmailCollision}.
 */
export function hasMeetChannelEmailCollisionOnSave(input: {
  meetingUrl: string;
  attendees: CalendarAttendee[];
  invitees: CalendarInvitee[];
}): boolean {
  return hasMeetChannelEmailCollision(input);
}

export type MeetChannelEmailChoice = "keep-both" | "strip-emails" | "replace-with-room";

export type AdHocMeetRoomLink = {
  href: string;
  roomCode: string;
};

export function createAdHocMeetRoomLink(workspaceOrigin: string): AdHocMeetRoomLink {
  const roomCode = createMeetRoomCode();
  return { href: buildMeetGuestCallLink(roomCode, workspaceOrigin), roomCode };
}

/**
 * Guest-capable replacement for a channel URL. Reuses an existing ad-hoc room
 * code when the form already has one (Meet create staged reserve).
 */
export function guestRoomReplacementForChannelUrl(
  meetingUrl: string,
  workspaceOrigin: string,
): AdHocMeetRoomLink {
  const parsed = parseMeetInvitePath(meetingUrl);
  if (parsed?.roomKind === "code") {
    return { href: buildMeetGuestCallLink(parsed.room, workspaceOrigin), roomCode: parsed.room };
  }
  return createAdHocMeetRoomLink(workspaceOrigin);
}

export function applyMeetChannelEmailChoice(
  form: CalendarEventFormValue,
  choice: MeetChannelEmailChoice,
  invitees: CalendarInvitee[],
  room?: AdHocMeetRoomLink,
): CalendarEventFormValue {
  if (choice === "keep-both") {
    return { ...form, meetGuestRoomOverride: false };
  }
  if (choice === "strip-emails") {
    const emailOnly = emailOnlyCalendarAttendees(form.attendees, invitees);
    return {
      ...form,
      meetGuestRoomOverride: false,
      attendees: form.attendees.filter(
        (row) =>
          row.isOrganizer ||
          !emailOnly.some((guest) => attendeesReferToSamePerson(row, guest, invitees)),
      ),
    };
  }
  const nextRoom = room ?? guestRoomReplacementForChannelUrl(form.meetingUrl, "");
  return {
    ...form,
    meetingUrl: nextRoom.href,
    meetRoomCode: nextRoom.roomCode,
    meetGuestRoomOverride: true,
  };
}

/** Directory users → calendar invitee rows for email-only detection. */
export function calendarInviteesFromShareDirectory(
  directory: readonly CollectionSharePrincipal[] | undefined,
): CalendarInvitee[] {
  return (directory ?? [])
    .filter((row) => row.principalType === "user" && row.id.trim())
    .map((row) => ({
      username: row.id,
      email: "",
      name: row.displayName.trim() || row.id,
    }));
}

/** Channel share stays workspace people/groups — drop email-looking principals. */
export function workspaceOnlySharePrincipals<T extends { id: string; principalType: string }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => row.principalType !== "email" && !row.id.includes("@"));
}
