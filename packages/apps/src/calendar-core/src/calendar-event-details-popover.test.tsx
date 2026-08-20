import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("shows title, time, calendar, and Edit", { timeout: 10_000 }, () => {
    const { onEdit } = renderPopover({
      origin: { left: 48, top: 96, width: 180, height: 36 },
    });
    expect(screen.getByRole("heading", { name: /Dentist/i })).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.eventWhenSectionTitle)).toBeTruthy();
    const popover = screen.getByRole("dialog", { name: /Dentist/i });
    expect(popover.className).toContain("calendar-event-details-popover");
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("does not force Edit when the user cannot write", { timeout: 10_000 }, () => {
    renderPopover({ canEdit: false, onEdit: undefined });
    expect(screen.getByRole("heading", { name: /Dentist/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
    ).toBeNull();
  });

  it("keeps RSVP reachable for an invitee without opening the editor", { timeout: 10_000 }, () => {
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

  it("shifts away from viewport edges with collision padding", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "calendar-event-details-popover.tsx"), "utf8");
    expect(source).toContain("collisionPadding={16}");
    expect(source).toContain("avoidCollisions={!docked}");
  });

  it(
    "docks a tall compact-month origin instead of stretching to the cell",
    { timeout: 10_000 },
    () => {
      renderPopover({
        origin: { left: 160, top: 72, width: 44, height: 160 },
      });
      const popover = screen.getByRole("dialog", { name: /Dentist/i });
      expect(popover.className).toContain("calendar-event-details-popover--docked");
    },
  );
});
