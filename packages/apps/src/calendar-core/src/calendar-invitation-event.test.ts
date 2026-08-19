import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR_COLOR } from "@/calendar-core/src/calendar-calendar-dialog";
import {
  canRespondInvitation,
  collapseInvitationsByUid,
  filterInviteeNotifications,
  filterInvitationsByTab,
  invitationInboxTab,
  invitationMethod,
  invitationToEventCardFields,
  pendingInvitationCount,
} from "@/calendar-core/src/calendar-invitation-event";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarSchedulingNotification } from "@/lib/api/wgw/calendar-scheduling";

function notification(
  overrides: Partial<CalendarSchedulingNotification> = {},
): CalendarSchedulingNotification {
  return {
    id: "invite-1.ics",
    uid: "uid-1",
    method: "REQUEST",
    title: "Standup",
    organizerEmail: "bob@example.test",
    start: "2026-08-20T14:00:00",
    end: "2026-08-20T15:00:00",
    participationStatus: "needs-action",
    eventId: "invite-copy",
    ...overrides,
  };
}

describe("invitationInboxTab", () => {
  it("classifies needs-action REQUEST as new", () => {
    expect(invitationInboxTab(notification())).toBe("new");
  });

  it("hides CANCEL instead of parking it in New", () => {
    expect(invitationInboxTab(notification({ method: "CANCEL", title: "Canceled standup" }))).toBe(
      null,
    );
  });

  it("hides the current user's own events from the invitee inbox", () => {
    expect(invitationInboxTab(notification({ organizerEmail: "admin@localhost" }))).toBe("new");
    expect(
      filterInviteeNotifications(
        [notification({ organizerEmail: "admin@localhost", title: "Own standup" })],
        ["admin@localhost", "admin"],
      ),
    ).toEqual([]);
    expect(
      filterInviteeNotifications(
        [notification({ organizerEmail: "admin" })],
        ["admin@localhost", "admin"],
      ),
    ).toEqual([]);
  });

  it("classifies accepted, tentative, and declined as responded", () => {
    expect(invitationInboxTab(notification({ participationStatus: "accepted" }))).toBe("responded");
    expect(invitationInboxTab(notification({ participationStatus: "tentative" }))).toBe(
      "responded",
    );
    expect(invitationInboxTab(notification({ participationStatus: "declined" }))).toBe("responded");
  });

  it("treats missing or lowercase METHOD as REQUEST", () => {
    expect(invitationMethod(notification({ method: "" }))).toBe("REQUEST");
    expect(invitationMethod(notification({ method: "request" }))).toBe("REQUEST");
    expect(
      invitationInboxTab(notification({ method: "", participationStatus: "needs-action" })),
    ).toBe("new");
  });
});

describe("canRespondInvitation", () => {
  it("allows RSVP for REQUEST / needs-action, including missing METHOD", () => {
    expect(canRespondInvitation(notification())).toBe(true);
    expect(canRespondInvitation(notification({ method: "request" }))).toBe(true);
    expect(canRespondInvitation(notification({ method: "" }))).toBe(true);
    expect(canRespondInvitation(notification({ method: "CANCEL" }))).toBe(false);
    expect(canRespondInvitation(notification({ participationStatus: "accepted" }))).toBe(true);
    expect(canRespondInvitation(notification({ eventId: null }))).toBe(false);
  });
});

describe("filterInvitationsByTab", () => {
  it("splits pending and responded rows", () => {
    const rows = [
      notification(),
      notification({ id: "invite-2.ics", uid: "uid-2", method: "CANCEL", title: "Canceled" }),
      notification({
        id: "invite-3.ics",
        uid: "uid-3",
        participationStatus: "accepted",
        title: "Planning",
      }),
    ];

    expect(filterInvitationsByTab(rows, "new").map((row) => row.id)).toEqual(["invite-1.ics"]);
    expect(filterInvitationsByTab(rows, "responded").map((row) => row.title)).toEqual(["Planning"]);
    expect(pendingInvitationCount(rows)).toBe(1);
  });

  it("collapses stacked REQUEST copies for the same UID to the latest row", () => {
    const rows = [
      notification({
        id: "req-1.ics",
        uid: "same-event",
        start: "2030-01-15T13:45:00Z",
        title: "Another event",
      }),
      notification({
        id: "req-2.ics",
        uid: "same-event",
        start: "2030-01-15T14:45:00Z",
        title: "Another event",
      }),
      notification({
        id: "req-3.ics",
        uid: "same-event",
        start: "2030-01-15T15:45:00Z",
        title: "Another event",
      }),
      notification({ id: "other.ics", uid: "other-event", title: "Other" }),
    ];

    const collapsed = collapseInvitationsByUid(rows);
    expect(collapsed.map((row) => row.id)).toEqual(["req-3.ics", "other.ics"]);
    expect(filterInvitationsByTab(rows, "new").map((row) => row.id)).toEqual([
      "req-3.ics",
      "other.ics",
    ]);
    expect(pendingInvitationCount(rows)).toBe(2);
  });
});

describe("invitationToEventCardFields", () => {
  it("maps title, when, location, and calendar color onto event-card fields", () => {
    const fields = invitationToEventCardFields(
      notification({
        location: "Room 4",
        color: "#0ea5e9",
      }),
      defaultCalendarLabels,
      "en-US",
    );

    expect(fields.summary).toBe("Standup");
    expect(fields.location).toBe("Room 4");
    expect(fields.color).toBe("#0ea5e9");
    expect(fields.cancelled).toBe(false);
    expect(fields.recurring).toBe(false);
    expect(fields.time).toMatch(/Thu, Aug 20/);
  });

  it("falls back to untitled + default calendar color", () => {
    const fields = invitationToEventCardFields(
      notification({ title: "  ", location: null, color: null }),
      defaultCalendarLabels,
      "en-US",
    );

    expect(fields.summary).toBe(defaultCalendarLabels.untitledEvent);
    expect(fields.location).toBe("");
    expect(fields.color).toBe(DEFAULT_CALENDAR_COLOR);
  });

  it("marks CANCEL as cancelled so the event card can use its dimmed state", () => {
    const fields = invitationToEventCardFields(
      notification({ method: "CANCEL", title: "Canceled standup" }),
      defaultCalendarLabels,
      "en-US",
    );

    expect(fields.cancelled).toBe(true);
    expect(fields.summary).toBe("Canceled standup");
  });

  it("passes recurring through for the event-card repeat icon", () => {
    const fields = invitationToEventCardFields(
      notification({ recurring: true }),
      defaultCalendarLabels,
      "en-US",
    );
    expect(fields.recurring).toBe(true);
  });
});
