import { describe, expect, it } from "vitest";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { normalizeParticipantAddress } from "@/calendar-core/src/calendar-attendees";
import {
  calendarInviteeSearchRows,
  contactEmailToAttendee,
  contactInviteEmails,
  explodeContactInviteeSearchRows,
  findInviteeForAddress,
  teammateSearchRow,
  typedEmailSearchRow,
} from "@/calendar-core/src/calendar-contact-attendee";

function card(overrides: Record<string, unknown>): ContactCard {
  return {
    "@type": "Card",
    version: "1.0",
    id: "card-jane",
    uid: "urn:uuid:jane",
    addressBookIds: { default: true },
    name: { "@type": "Name", isOrdered: false, full: "Jane Host" },
    ...overrides,
  } as unknown as ContactCard;
}

describe("calendar-contact-attendee", () => {
  it("treats Jane@Host, jane@host, and mailto:jane@host as the same address", () => {
    expect(normalizeParticipantAddress("Jane@Host")).toBe("jane@host");
    expect(normalizeParticipantAddress("jane@host")).toBe("jane@host");
    expect(normalizeParticipantAddress("mailto:jane@host")).toBe("jane@host");
    expect(normalizeParticipantAddress("  mailto:Jane@Host  ")).toBe("jane@host");
  });

  it("omits schedulingAddresses mailto when emails[] already has that address after normalize", () => {
    const rows = contactInviteEmails(
      card({
        emails: {
          e1: { "@type": "EmailAddress", address: "Jane@Host", contexts: { work: true } },
        },
        schedulingAddresses: {
          s1: { "@type": "SchedulingAddress", uri: "mailto:jane@host" },
        },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "jane@host",
      rawEmail: "Jane@Host",
      contactContext: "work",
    });
  });

  it("includes schedulingAddresses mailto as its own row when not in emails[]", () => {
    const rows = contactInviteEmails(
      card({
        emails: {
          e1: { "@type": "EmailAddress", address: "work@host", contexts: { work: true } },
        },
        schedulingAddresses: {
          s1: { "@type": "SchedulingAddress", uri: "mailto:Jane@Host", contexts: { home: true } },
        },
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.email)).toEqual(["work@host", "jane@host"]);
    expect(rows[1]).toMatchObject({
      rawEmail: "Jane@Host",
      contactContext: "home",
    });
  });

  it("dedups the same address listed twice on one card (case and mailto variants)", () => {
    const rows = contactInviteEmails(
      card({
        emails: {
          e1: { "@type": "EmailAddress", address: "Jane@Host" },
          e2: { "@type": "EmailAddress", address: "mailto:jane@host" },
        },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rawEmail).toBe("Jane@Host");
    expect(rows[0]?.email).toBe("jane@host");
  });

  it("keeps exploded rawEmail Jane@Host while email is the normalized lookup key", () => {
    const [row] = explodeContactInviteeSearchRows(
      card({
        emails: {
          e1: { "@type": "EmailAddress", address: "Jane@Host", contexts: { work: true } },
        },
      }),
    );
    expect(row).toMatchObject({
      source: "contact",
      rawEmail: "Jane@Host",
      email: "jane@host",
      displayName: "Jane Host",
      contactContext: "work",
      id: "contact:card-jane:jane@host",
    });
  });

  it("maps unknown JSContact context such as private to undefined", () => {
    const [row] = explodeContactInviteeSearchRows(
      card({
        emails: {
          e1: { "@type": "EmailAddress", address: "private@host", contexts: { private: true } },
        },
      }),
    );
    expect(row?.contactContext).toBeUndefined();
    expect(row?.rawEmail).toBe("private@host");
  });

  it("skips group cards and cards with no inviteable address", () => {
    expect(
      explodeContactInviteeSearchRows(
        card({
          kind: "group",
          emails: { e1: { "@type": "EmailAddress", address: "group@host" } },
        }),
      ),
    ).toEqual([]);
    expect(explodeContactInviteeSearchRows(card({ emails: {} }))).toEqual([]);
    expect(
      explodeContactInviteeSearchRows(
        card({
          members: { "urn:uuid:someone": true },
          emails: { e1: { "@type": "EmailAddress", address: "member-owner@host" } },
        }),
      ),
    ).toEqual([]);
  });

  it("namespaces ids so teammate, contact, and typed-email stay unique before omit", () => {
    const email = "jane@host";
    const teammate = teammateSearchRow({
      username: "jane",
      email: "Jane@Host",
      name: "Jane",
    });
    const [contact] = explodeContactInviteeSearchRows(
      card({
        emails: { e1: { "@type": "EmailAddress", address: "Jane@Host" } },
      }),
    );
    const typed = typedEmailSearchRow("Jane@Host");
    expect(teammate.id).toBe(`teammate:${email}`);
    expect(contact?.id).toBe(`contact:card-jane:${email}`);
    expect(typed?.id).toBe(`typed-email:${email}`);
    expect(new Set([teammate.id, contact?.id, typed?.id]).size).toBe(3);
  });

  it("typedEmailSearchRow keeps casing and replaces the old email: prefix path", () => {
    const row = typedEmailSearchRow("  mailto:Jane@Host  ");
    expect(row).toMatchObject({
      source: "typed-email",
      id: "typed-email:jane@host",
      email: "jane@host",
      rawEmail: "Jane@Host",
      displayName: "Jane@Host",
    });
    expect(row?.id.startsWith("email:")).toBe(false);
  });

  it("findInviteeForAddress hits an invitee alias (username ≠ email)", () => {
    const invitee = { username: "jane", email: "other@host", name: "Jane Teammate" };
    const found = findInviteeForAddress("jane", [invitee]);
    expect(found).toEqual(invitee);
    expect(
      contactEmailToAttendee({ email: "jane", rawEmail: "Jane", displayName: "Jane Host" }, [
        invitee,
      ]).email,
    ).toBe("other@host");
  });

  it("stores inviteeAddress on hit and rawEmail casing when invitees is empty", () => {
    const invitee = { username: "jane", email: "Jane@Host", name: "Jane Teammate" };
    const row = {
      email: "jane@host",
      rawEmail: "Jane@Host",
      displayName: "Jane Host",
    };
    expect(contactEmailToAttendee(row, [invitee]).email).toBe("Jane@Host");
    expect(contactEmailToAttendee(row, []).email).toBe("Jane@Host");
    expect(contactEmailToAttendee(row, []).email).not.toBe("jane@host");
  });

  it("findInviteeForAddress only searches the passed invitees array", () => {
    const invitee = { username: "jane", email: "Jane@Host", name: "Jane" };
    expect(findInviteeForAddress("Jane@Host", [invitee])).toEqual(invitee);
    expect(findInviteeForAddress("mailto:JANE@HOST", [invitee])).toEqual(invitee);
    expect(findInviteeForAddress("Jane@Host", [])).toBeUndefined();
  });

  it("omits a contact row when an existing attendee matches after normalize, not raw equality", () => {
    const cards = [
      card({
        emails: { e1: { "@type": "EmailAddress", address: "jane@host" } },
      }),
    ];
    const rows = calendarInviteeSearchRows({
      query: "jane",
      invitees: [],
      attendees: [
        {
          email: "Jane@Host",
          name: "Jane",
          participationStatus: "needs-action",
          role: "required",
        },
      ],
      cards,
    });
    expect(rows.filter((row) => row.source === "contact")).toEqual([]);
  });

  it("omits a contact row that matches a teammate after normalize, keeping other emails on the card", () => {
    const rows = calendarInviteeSearchRows({
      query: "jane",
      invitees: [{ username: "jane", email: "Jane@Host", name: "Jane Teammate" }],
      attendees: [],
      sessionEmail: "admin@localhost",
      cards: [
        card({
          emails: {
            e1: { "@type": "EmailAddress", address: "jane@host", contexts: { work: true } },
            e2: { "@type": "EmailAddress", address: "jane.home@host", contexts: { home: true } },
          },
        }),
      ],
    });
    expect(rows.filter((row) => row.source === "teammate")).toHaveLength(1);
    expect(rows.filter((row) => row.source === "contact")).toEqual([
      expect.objectContaining({
        source: "contact",
        rawEmail: "jane.home@host",
        contactContext: "home",
      }),
    ]);
  });

  it("keeps teammate rows when contact cards also match the same query", () => {
    const rows = calendarInviteeSearchRows({
      query: "ja",
      invitees: [
        { username: "jane", email: "jane@host", name: "Jane Teammate" },
        { username: "jack", email: "jack@host", name: "Jack" },
      ],
      attendees: [],
      sessionEmail: "admin@localhost",
      cards: [
        card({
          id: "card-jane",
          name: { "@type": "Name", isOrdered: false, full: "Jane Host" },
          emails: {
            e1: { "@type": "EmailAddress", address: "jane@host", contexts: { work: true } },
          },
        }),
        card({
          id: "card-jason",
          name: { "@type": "Name", isOrdered: false, full: "Jason Contact" },
          emails: { e1: { "@type": "EmailAddress", address: "jason@host" } },
        }),
      ],
    });
    expect(rows.filter((row) => row.source === "teammate").map((row) => row.displayName)).toEqual([
      "Jane Teammate",
      "Jack",
    ]);
    expect(rows.some((row) => row.source === "contact" && row.email === "jane@host")).toBe(false);
    expect(rows.some((row) => row.source === "contact" && row.email === "jason@host")).toBe(true);
  });

  it("keeps the teammate row when only the contact card matches the query", () => {
    const rows = calendarInviteeSearchRows({
      query: "Jane",
      invitees: [{ username: "jdoe", email: "jdoe@company.com", name: "J. Doe" }],
      attendees: [],
      sessionEmail: "admin@localhost",
      cards: [
        card({
          id: "card-jane-doe",
          name: { "@type": "Name", isOrdered: false, full: "Jane Doe" },
          emails: {
            e1: { "@type": "EmailAddress", address: "jdoe@company.com", contexts: { work: true } },
          },
        }),
      ],
    });
    expect(rows.filter((row) => row.source === "teammate")).toEqual([
      expect.objectContaining({
        source: "teammate",
        displayName: "J. Doe",
        email: "jdoe@company.com",
      }),
    ]);
    expect(rows.filter((row) => row.source === "contact")).toEqual([]);
  });

  it("excludes the session user's own address from contact rows", () => {
    const rows = calendarInviteeSearchRows({
      query: "admin",
      invitees: [],
      attendees: [],
      sessionEmail: "Admin@Localhost",
      cards: [
        card({
          id: "card-admin",
          name: { "@type": "Name", isOrdered: false, full: "Admin" },
          emails: { e1: { "@type": "EmailAddress", address: "admin@localhost" } },
        }),
      ],
    });
    expect(rows.filter((row) => row.source === "contact")).toEqual([]);
  });
});
