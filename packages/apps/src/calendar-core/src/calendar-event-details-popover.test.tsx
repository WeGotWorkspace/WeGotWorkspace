import type React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarEventDetailsPopover } from "@/calendar-core/src/calendar-event-details-popover";
import { resolveCalendarEventPreview } from "@/calendar-core/src/calendar-event-preview";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";

const bootstrap = createCalendarAppBootstrap();

function renderPopover(
  overrides: Partial<React.ComponentProps<typeof CalendarEventDetailsPopover>> = {},
) {
  const onEdit = vi.fn();
  const onClose = vi.fn();
  const onRsvp = vi.fn();
  const preview =
    overrides.preview ?? resolveCalendarEventPreview("dentist", { events: bootstrap.data.events });

  render(
    <CalendarEventDetailsPopover
      open
      preview={preview}
      calendars={bootstrap.data.calendars}
      labels={defaultCalendarLabels}
      locale="en-US"
      untitledLabel={defaultCalendarLabels.untitledEvent}
      canEdit
      onEdit={onEdit}
      onClose={onClose}
      {...overrides}
    />,
  );

  return { onEdit, onClose, onRsvp };
}

describe("CalendarEventDetailsPopover", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows title, time, calendar, and Edit", () => {
    const { onEdit } = renderPopover();
    expect(screen.getByRole("heading", { name: /Dentist/i })).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.eventWhenSectionTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("does not force Edit when the user cannot write", () => {
    renderPopover({ canEdit: false, onEdit: undefined });
    expect(screen.getByRole("heading", { name: /Dentist/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
    ).toBeNull();
  });

  it("keeps RSVP reachable for an invitee without opening the editor", () => {
    const preview = {
      eventId: "awaiting-reply",
      form: {
        ...emptyCalendarEventForm("work", "2033-01-11"),
        title: "Partner sync",
        attendees: [
          {
            email: "ada@example.test",
            name: "Ada",
            participationStatus: "accepted" as const,
            isOrganizer: true,
          },
          {
            email: "me@example.test",
            name: "Me",
            participationStatus: "needs-action" as const,
          },
        ],
      },
    };
    const onRsvp = vi.fn();
    renderPopover({
      preview,
      sessionEmail: "me@example.test",
      onRsvp,
    });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept }));
    expect(onRsvp).toHaveBeenCalledWith("accepted");
    expect(screen.queryByRole("dialog", { name: defaultCalendarLabels.editEventTitle })).toBeNull();
  });
});
