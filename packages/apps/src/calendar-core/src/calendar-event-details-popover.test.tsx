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

  const view = render(
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

  return { onEdit, onClose, onRsvp, container: view.container };
}

describe("CalendarEventDetailsPopover", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows title with color swatch, time, and Edit", { timeout: 10_000 }, () => {
    const { onEdit } = renderPopover({
      origin: { left: 48, top: 96, width: 180, height: 36 },
    });
    const heading = screen.getByRole("heading", { name: /Dentist/i });
    expect(heading.querySelector(".calendar-event-details-popover__swatch")).toBeTruthy();
    expect(screen.queryByText("Personal")).toBeNull();
    expect(document.querySelector(".calendar-event-details-popover__calendar")).toBeNull();
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

  it(
    "hides Edit on a read-only share even when canEdit is globally true",
    { timeout: 10_000 },
    () => {
      const preview = {
        eventId: "school-play",
        form: { ...emptyCalendarEventForm("family", "2033-01-14"), title: "School play" },
      };
      renderPopover({ preview, canEdit: true });
      expect(screen.getByRole("heading", { name: /School play/i })).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
      ).toBeNull();
    },
  );

  it("shows Edit for a group member who is not the organizer", { timeout: 10_000 }, () => {
    const preview = {
      eventId: "desk-review",
      form: {
        ...emptyCalendarEventForm("group-editorial", "2033-01-12"),
        title: "Desk review",
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
            participationStatus: "accepted" as const,
          },
        ],
      },
    };
    const { onEdit } = renderPopover({
      preview,
      sessionEmail: "me@example.test",
      canEdit: true,
    });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }));
    expect(onEdit).toHaveBeenCalledTimes(1);
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
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
    ).toBeNull();
  });

  it("shows Edit for a write-share recipient who is not the organizer", { timeout: 10_000 }, () => {
    const calendars = bootstrap.data.calendars.map((calendar) =>
      calendar.id === "default" ? { ...calendar, mayShare: false, mayWrite: true } : calendar,
    );
    const preview = {
      eventId: "shared-slot",
      form: {
        ...emptyCalendarEventForm("default", "2033-01-12"),
        title: "Shared slot",
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
            participationStatus: "accepted" as const,
          },
        ],
      },
    };
    renderPopover({
      preview,
      calendars,
      sessionEmail: "me@example.test",
      canEdit: true,
    });
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
    ).toBeTruthy();
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

  it(
    "keeps a tall week-view segment compact instead of docking full-width",
    { timeout: 10_000 },
    () => {
      const { container } = renderPopover({
        origin: { left: 420, top: 160, width: 168, height: 420 },
      });
      const popover = screen.getByRole("dialog", { name: /Dentist/i });
      expect(popover.className).toContain("calendar-event-details-popover");
      expect(popover.className).not.toContain("calendar-event-details-popover--docked");
      const anchor = container.ownerDocument.querySelector(
        ".calendar-event-details-popover__anchor",
      );
      expect(anchor).toBeInstanceOf(HTMLElement);
      expect((anchor as HTMLElement).style.width).toBe("168px");
      expect((anchor as HTMLElement).style.height).toBe("40px");
    },
  );

  it("shows a primary Join button below the details rows", { timeout: 10_000 }, () => {
    const onJoinMeeting = vi.fn();
    const href = "https://workspace.example.com/meet/guest?room=h8y8-ewp6-al8n";
    renderPopover({
      workspaceOrigin: "https://workspace.example.com",
      onJoinMeeting,
      preview: {
        eventId: "standup",
        form: {
          ...emptyCalendarEventForm("default", "2033-01-12"),
          title: "Standup",
          meetingUrl: href,
        },
      },
    });
    const join = screen.getByRole("button", { name: defaultCalendarLabels.eventMeetJoin });
    expect(join.className).toContain("button--variant-primary");
    expect(join.closest(".calendar-event-details-popover__meet")).toBeTruthy();
    expect(join.closest(".calendar-event-details-popover__row")).toBeNull();
    fireEvent.click(join);
    expect(onJoinMeeting).toHaveBeenCalledWith(href);
  });
});
