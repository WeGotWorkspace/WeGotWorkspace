import { describe, expect, it } from "vitest";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import {
  applyMeetChannelEmailChoice,
  calendarInviteesFromShareDirectory,
  createAdHocMeetRoomLink,
  emailOnlyCalendarAttendees,
  guestRoomReplacementForChannelUrl,
  hasMeetChannelEmailCollision,
  hasMeetChannelEmailCollisionOnSave,
  isCalendarMeetChannelUrl,
  isDirectoryCalendarAttendee,
  workspaceOnlySharePrincipals,
} from "@/calendar-core/src/calendar-meet-channel-email";
import type { CalendarAttendee, CalendarInvitee } from "@/calendar-core/src/calendar-attendees";

const ORIGIN = "https://workspace.example.com";
const CHANNEL = `${ORIGIN}/meet/channels/chat-01h455vb4pa9nnrjpznsav8hva`;
const MEETING_COLLECTION = `${ORIGIN}/meet/meetings/standup`;
const ROOM = "h8y8-ewp6-al8n";
const ROOM_URL = `${ORIGIN}/meet/meetings/${ROOM}`;
const RELATIVE_CHANNEL = "/meet/channels/general";

const directory: CalendarInvitee[] = [
  { username: "wouter", email: "wouter@woutervroege.nl", name: "Wouter" },
  { username: "tester", email: "", name: "Tester" },
];

const organizer: CalendarAttendee = {
  email: "admin@localhost",
  name: "Admin",
  participationStatus: "accepted",
  isOrganizer: true,
};

const teammate: CalendarAttendee = {
  email: "wouter@woutervroege.nl",
  name: "Wouter",
  participationStatus: "needs-action",
  role: "required",
};

const teammateByUsername: CalendarAttendee = {
  email: "tester",
  name: "Tester",
  participationStatus: "needs-action",
  role: "required",
};

const guest: CalendarAttendee = {
  email: "guest@elsewhere.test",
  name: "guest@elsewhere.test",
  participationStatus: "needs-action",
  role: "required",
};

const contact: CalendarAttendee = {
  email: "Jane@Host",
  name: "Jane Host",
  participationStatus: "needs-action",
  role: "required",
};

function form(overrides: Partial<ReturnType<typeof emptyCalendarEventForm>> = {}) {
  return {
    ...emptyCalendarEventForm("default", "2033-01-12"),
    title: "Standup",
    ...overrides,
  };
}

describe("isCalendarMeetChannelUrl", () => {
  it("treats only /meet/channels paths as members-only channels", () => {
    expect(isCalendarMeetChannelUrl(CHANNEL)).toBe(true);
    expect(isCalendarMeetChannelUrl(RELATIVE_CHANNEL)).toBe(true);
    expect(isCalendarMeetChannelUrl("/meet/channels/general")).toBe(true);
  });

  it("does not treat meetings, ad-hoc room codes, or external https as channels", () => {
    expect(isCalendarMeetChannelUrl(MEETING_COLLECTION)).toBe(false);
    expect(isCalendarMeetChannelUrl("/meet/meetings/sprint-planning")).toBe(false);
    expect(isCalendarMeetChannelUrl("/meet/meetings/test-meet")).toBe(false);
    expect(isCalendarMeetChannelUrl(ROOM_URL)).toBe(false);
    expect(isCalendarMeetChannelUrl(`${ORIGIN}/meet/guest?room=${ROOM}`)).toBe(false);
    expect(isCalendarMeetChannelUrl(`${ORIGIN}/meet?room=${ROOM}`)).toBe(false);
    expect(isCalendarMeetChannelUrl("https://zoom.us/j/123")).toBe(false);
    expect(isCalendarMeetChannelUrl("")).toBe(false);
  });
});

describe("email-only vs directory attendees", () => {
  it("matches workspace invitees by email or username alias", () => {
    expect(isDirectoryCalendarAttendee(teammate, directory)).toBe(true);
    expect(isDirectoryCalendarAttendee(teammateByUsername, directory)).toBe(true);
    expect(isDirectoryCalendarAttendee(organizer, directory)).toBe(true);
    expect(isDirectoryCalendarAttendee(guest, directory)).toBe(false);
    expect(isDirectoryCalendarAttendee(contact, directory)).toBe(false);
  });

  it("lists only non-directory, non-organizer attendees as email-only", () => {
    expect(
      emailOnlyCalendarAttendees(
        [organizer, teammate, teammateByUsername, guest, contact],
        directory,
      ).map((row) => row.email),
    ).toEqual(["guest@elsewhere.test", "Jane@Host"]);
  });
});

describe("hasMeetChannelEmailCollision", () => {
  it("is true only for a channel URL with at least one email-only invitee", () => {
    expect(
      hasMeetChannelEmailCollision({
        meetingUrl: CHANNEL,
        attendees: [organizer, guest],
        invitees: directory,
      }),
    ).toBe(true);
    expect(
      hasMeetChannelEmailCollision({
        meetingUrl: MEETING_COLLECTION,
        attendees: [organizer, guest],
        invitees: directory,
      }),
    ).toBe(false);
    expect(
      hasMeetChannelEmailCollision({
        meetingUrl: CHANNEL,
        attendees: [organizer, teammate],
        invitees: directory,
      }),
    ).toBe(false);
    expect(
      hasMeetChannelEmailCollision({
        meetingUrl: ROOM_URL,
        attendees: [organizer, guest],
        invitees: directory,
      }),
    ).toBe(false);
    expect(
      hasMeetChannelEmailCollision({
        meetingUrl: "/meet/channels/general",
        attendees: [organizer, guest],
        invitees: directory,
      }),
    ).toBe(true);
    expect(
      hasMeetChannelEmailCollision({
        meetingUrl: "/meet/meetings/test-meet",
        attendees: [organizer, guest],
        invitees: directory,
      }),
    ).toBe(false);
    expect(
      hasMeetChannelEmailCollision({
        meetingUrl: CHANNEL,
        attendees: [organizer],
        invitees: directory,
      }),
    ).toBe(false);
  });

  it("does not treat Meet create (meeting-kind URL on save) as a collision", () => {
    expect(
      hasMeetChannelEmailCollisionOnSave({
        meetingUrl: ROOM_URL,
        attendees: [organizer, guest],
        invitees: directory,
      }),
    ).toBe(false);
    expect(
      hasMeetChannelEmailCollisionOnSave({
        meetingUrl: MEETING_COLLECTION,
        attendees: [organizer, guest],
        invitees: directory,
      }),
    ).toBe(false);
    expect(
      hasMeetChannelEmailCollisionOnSave({
        meetingUrl: CHANNEL,
        attendees: [organizer, guest],
        invitees: directory,
      }),
    ).toBe(true);
  });
});

describe("applyMeetChannelEmailChoice", () => {
  const colliding = form({
    meetingUrl: CHANNEL,
    attendees: [organizer, teammate, guest, contact],
  });

  it("keep-both leaves URL and invitees, and does not prefer a guest room", () => {
    expect(applyMeetChannelEmailChoice(colliding, "keep-both", directory)).toEqual({
      ...colliding,
      meetGuestRoomOverride: false,
    });
  });

  it("strip-emails drops email-only attendees and keeps workspace invitees", () => {
    const next = applyMeetChannelEmailChoice(colliding, "strip-emails", directory);
    expect(next.meetingUrl).toBe(CHANNEL);
    expect(next.meetGuestRoomOverride).toBe(false);
    expect(next.attendees).toEqual([organizer, teammate]);
  });

  it("replace-with-room keeps email invitees and swaps in a guest room URL", () => {
    const room = { href: ROOM_URL, roomCode: ROOM };
    const next = applyMeetChannelEmailChoice(colliding, "replace-with-room", directory, room);
    expect(next.meetingUrl).toBe(ROOM_URL);
    expect(next.meetRoomCode).toBe(ROOM);
    expect(next.meetGuestRoomOverride).toBe(true);
    expect(next.attendees).toEqual(colliding.attendees);
    expect(next.meetingUrl).not.toMatch(/\/guest/);
  });
});

describe("guest room replacement", () => {
  it("reuses an existing ad-hoc room code and never emits /guest", () => {
    const reused = guestRoomReplacementForChannelUrl(ROOM_URL, ORIGIN);
    expect(reused.roomCode).toBe(ROOM);
    expect(reused.href).toBe(ROOM_URL);
    expect(reused.href).not.toMatch(/\/guest/);
  });

  it("generates a new room code for a channel URL", () => {
    const generated = createAdHocMeetRoomLink(ORIGIN);
    expect(generated.roomCode).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(generated.href).toBe(`${ORIGIN}/meet/meetings/${generated.roomCode}`);
    expect(generated.href).not.toMatch(/\/guest/);
    const fromChannel = guestRoomReplacementForChannelUrl(CHANNEL, ORIGIN);
    expect(fromChannel.roomCode).not.toBe("chat-01h455vb4pa9nnrjpznsav8hva");
    expect(fromChannel.href).toMatch(/\/meet\/meetings\//);
    expect(fromChannel.href).not.toMatch(/\/guest/);
  });
});

describe("directory mapping and share filter", () => {
  it("maps user principals to invitee rows and skips groups", () => {
    expect(
      calendarInviteesFromShareDirectory([
        { id: "ada.lovelace", displayName: "Ada Lovelace", principalType: "user" },
        { id: "groups/eng", displayName: "Eng", principalType: "group" },
      ]),
    ).toEqual([{ username: "ada.lovelace", email: "", name: "Ada Lovelace" }]);
  });

  it("drops email-looking share principals", () => {
    expect(
      workspaceOnlySharePrincipals([
        { id: "bob", principalType: "user" },
        { id: "guest@elsewhere.test", principalType: "user" },
        { id: "groups/eng", principalType: "group" },
      ]),
    ).toEqual([
      { id: "bob", principalType: "user" },
      { id: "groups/eng", principalType: "group" },
    ]);
  });
});
