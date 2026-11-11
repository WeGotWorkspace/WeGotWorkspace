import { describe, expect, it } from "vitest";
import {
  attendeeRoleFromRoles,
  attendeesEqual,
  attendeesFromParticipants,
  attendeesIncludeInvitee,
  eventCardRsvpAttr,
  isLikelyEmail,
  isSessionEventInvitee,
  isSessionEventOrganizer,
  listedInviteeAttendees,
  normalizeParticipationStatus,
  organizerAttendeeForList,
  sessionEventInviteeStatus,
  organizerAddress,
  ownEventRsvpPresentation,
  participantsFromAttendees,
} from "@/lib/models/calendar-attendees";

describe("calendar attendees", () => {
  it("round-trips invitees and marks the organizer", () => {
    const attendees = attendeesFromParticipants({
      org: {
        "@type": "Participant",
        email: "bob@example.test",
        name: "Bob",
        roles: { owner: true },
        participationStatus: "accepted",
      },
      att1: {
        "@type": "Participant",
        email: "carol@example.test",
        name: "Carol",
        roles: { attendee: true },
        participationStatus: "needs-action",
      },
    });

    expect(attendees).toEqual([
      {
        email: "bob@example.test",
        name: "Bob",
        participationStatus: "accepted",
        role: "required",
        isOrganizer: true,
      },
      {
        email: "carol@example.test",
        name: "Carol",
        participationStatus: "needs-action",
        role: "required",
        isOrganizer: false,
      },
    ]);

    const wire = participantsFromAttendees(
      attendees.filter((row) => !row.isOrganizer),
      { email: "bob@example.test", name: "Bob" },
    );
    expect(wire?.org?.email).toBe("bob@example.test");
    expect(wire?.att1?.email).toBe("carol@example.test");
    expect(wire?.att1?.roles).toEqual({ attendee: true });
    expect(attendeesEqual(attendees, attendees)).toBe(true);
  });

  it("maps optional invitees to JMAP optional / ICS OPT-PARTICIPANT", () => {
    const attendees = attendeesFromParticipants({
      att1: {
        "@type": "Participant",
        email: "wouter",
        name: "Wouter",
        roles: { optional: true },
        participationStatus: "accepted",
      },
    });
    expect(attendees[0]).toMatchObject({
      email: "wouter",
      role: "optional",
      isOrganizer: false,
    });

    const wire = participantsFromAttendees(attendees, { email: "admin@localhost", name: "Admin" });
    expect(wire?.att1?.roles).toEqual({ optional: true });
  });

  it("merges owner and attendee rows for the same email", () => {
    const attendees = attendeesFromParticipants({
      org: {
        "@type": "Participant",
        email: "Wouter@woutervroege.nl",
        name: "Wouter",
        roles: { owner: true },
        participationStatus: "accepted",
      },
      att1: {
        "@type": "Participant",
        email: "mailto:wouter@woutervroege.nl",
        name: "Wouter",
        roles: { attendee: true },
        participationStatus: "needs-action",
      },
    });
    expect(attendees).toHaveLength(1);
    expect(attendees[0]).toMatchObject({
      email: "wouter@woutervroege.nl",
      isOrganizer: true,
    });
    expect(listedInviteeAttendees(attendees)).toEqual([]);
    expect(organizerAttendeeForList(attendees)?.email).toBe("wouter@woutervroege.nl");
  });

  it("injects the session organizer when the list has no owner row", () => {
    expect(organizerAttendeeForList([], [], "admin@localhost")).toMatchObject({
      email: "admin@localhost",
      isOrganizer: true,
    });
    expect(
      organizerAttendeeForList(
        [
          {
            email: "carol@example.test",
            name: "Carol",
            participationStatus: "needs-action",
            role: "required",
          },
        ],
        [],
        "carol@example.test",
      ),
    ).toBeNull();
  });

  it("dedupes username and email aliases for the same teammate", () => {
    const invitees = [{ username: "wouter", email: "wouter@woutervroege.nl", name: "Wouter" }];
    const listed = listedInviteeAttendees(
      [
        {
          email: "wouter",
          name: "Wouter",
          participationStatus: "needs-action",
          role: "required",
        },
        {
          email: "wouter@woutervroege.nl",
          name: "Wouter",
          participationStatus: "needs-action",
          role: "required",
        },
      ],
      invitees,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.email).toBe("wouter");
  });

  it("accepts a simple mailto-shaped address", () => {
    expect(isLikelyEmail("guest@elsewhere.test")).toBe(true);
    expect(isLikelyEmail("admin@localhost")).toBe(true);
    expect(isLikelyEmail("not-an-email")).toBe(false);
  });

  it("reads the current user's PARTSTAT and keeps organizer events solid", () => {
    const participants = {
      org: {
        "@type": "Participant" as const,
        email: "bob@example.test",
        roles: { owner: true },
        participationStatus: "accepted",
      },
      att1: {
        "@type": "Participant" as const,
        email: "carol@example.test",
        roles: { attendee: true },
        participationStatus: "needs-action",
      },
    };

    expect(ownEventRsvpPresentation(participants, "carol@example.test")).toBe("needs-action");
    expect(ownEventRsvpPresentation(participants, "bob@example.test")).toBeNull();
    expect(ownEventRsvpPresentation(participants, "nobody@example.test")).toBeNull();
    expect(eventCardRsvpAttr("needs-action")).toBe("needs-action");
    expect(eventCardRsvpAttr("tentative")).toBe("tentative");
    expect(eventCardRsvpAttr("accepted")).toBe("");
    expect(eventCardRsvpAttr("declined")).toBe("");
  });

  it("falls back to username when the session has no email", () => {
    expect(organizerAddress({ username: "admin", displayName: "Admin" })).toEqual({
      email: "admin",
      name: "Admin",
    });
    expect(organizerAddress({ email: "admin@localhost", username: "admin" })?.email).toBe(
      "admin@localhost",
    );
  });

  it("treats the ORGANIZER as owner, including username vs email aliases", () => {
    const attendees = attendeesFromParticipants({
      org: {
        "@type": "Participant" as const,
        email: "admin@localhost",
        name: "Admin",
        roles: { owner: true },
        participationStatus: "accepted",
      },
      att1: {
        "@type": "Participant" as const,
        email: "wouter",
        name: "Wouter",
        roles: { attendee: true },
        participationStatus: "needs-action",
      },
    });
    const invitees = [{ username: "wouter", email: "wouter@woutervroege.nl", name: "Wouter" }];

    expect(isSessionEventOrganizer(attendees, "admin@localhost")).toBe(true);
    expect(isSessionEventOrganizer(attendees, "admin")).toBe(true);
    expect(isSessionEventOrganizer(attendees, "wouter@woutervroege.nl", invitees)).toBe(false);
    expect(isSessionEventOrganizer(attendees, "wouter", invitees)).toBe(false);
    expect(isSessionEventInvitee(attendees, "wouter@woutervroege.nl", invitees)).toBe(true);
    expect(sessionEventInviteeStatus(attendees, "wouter@woutervroege.nl", invitees)).toBe(
      "needs-action",
    );
    expect(isSessionEventInvitee(attendees, "admin@localhost")).toBe(false);
    expect(sessionEventInviteeStatus(attendees, "admin@localhost")).toBeNull();
    expect(isSessionEventOrganizer([], "admin@localhost")).toBe(true);
    expect(
      isSessionEventOrganizer(
        [
          {
            email: "carol@example.test",
            name: "Carol",
            participationStatus: "needs-action",
            role: "required",
          },
        ],
        "carol@example.test",
      ),
    ).toBe(false);
  });

  it("finds an invitee among attendees by email or by username alias", () => {
    const carol = { username: "carol", email: "carol@example.test", name: "Carol" };
    const row = {
      email: "mailto:Carol@Example.test",
      name: "Carol",
      participationStatus: "accepted" as const,
    };
    expect(attendeesIncludeInvitee([row], carol)).toBe(true);
    expect(attendeesIncludeInvitee([], carol)).toBe(false);
    expect(attendeesIncludeInvitee([{ ...row, email: "dave@example.test" }], carol)).toBe(false);
  });

  it("normalizes every participation status and falls back to needs-action", () => {
    expect(normalizeParticipationStatus("ACCEPTED")).toBe("accepted");
    expect(normalizeParticipationStatus(" Tentative ")).toBe("tentative");
    expect(normalizeParticipationStatus("declined")).toBe("declined");
    expect(normalizeParticipationStatus("delegated")).toBe("delegated");
    expect(normalizeParticipationStatus("needs_action")).toBe("needs-action");
    expect(normalizeParticipationStatus(undefined)).toBe("needs-action");
  });

  it("reads the optional role from a role map or a role list", () => {
    expect(attendeeRoleFromRoles({ optional: true, attendee: false })).toBe("optional");
    expect(attendeeRoleFromRoles(["optional", ""])).toBe("optional");
    expect(attendeeRoleFromRoles(["attendee"])).toBe("required");
    expect(attendeeRoleFromRoles(undefined)).toBe("required");
  });
});
