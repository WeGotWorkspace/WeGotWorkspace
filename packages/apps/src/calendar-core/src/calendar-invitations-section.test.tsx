import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarInvitationsSection } from "@/calendar-core/src/calendar-invitations-section";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";

describe("CalendarInvitationsSection", () => {
  afterEach(() => cleanup());

  it("renders pending invitations with RSVP actions", () => {
    const onRespond = vi.fn();
    render(
      <CalendarInvitationsSection
        notifications={[
          {
            id: "invite-1.ics",
            uid: "uid-1",
            method: "REQUEST",
            title: "Standup",
            organizerEmail: "bob@example.test",
            organizerName: "Bob",
            participationStatus: "needs-action",
          },
        ]}
        labels={defaultCalendarLabels}
        onRespond={onRespond}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("Standup")).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept })).toBeTruthy();
  });
});
