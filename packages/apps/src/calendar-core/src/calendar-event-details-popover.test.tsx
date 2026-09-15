import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarEventDetailsPopover } from "@/calendar-core/src/calendar-event-details-popover";
import {
  formatEventPreviewWhen,
  resolveCalendarEventPreview,
} from "@/calendar-core/src/calendar-event-preview";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { TooltipProvider } from "@/ui/tooltip";

const bootstrap = createCalendarAppBootstrap();

function renderPopover(
  overrides: Partial<React.ComponentProps<typeof CalendarEventDetailsPopover>> = {},
) {
  const onClose = vi.fn();
  const onRsvp = vi.fn();
  const onDelete = vi.fn();
  const preview =
    overrides.preview ?? resolveCalendarEventPreview("dentist", { events: bootstrap.data.events });

  const view = render(
    <TooltipProvider delayDuration={0}>
      <CalendarEventDetailsPopover
        open
        preview={preview}
        calendars={bootstrap.data.calendars}
        labels={defaultCalendarLabels}
        locale="en-US"
        untitledLabel={defaultCalendarLabels.untitledEvent}
        canEdit
        onDelete={onDelete}
        onClose={onClose}
        {...overrides}
      />
    </TooltipProvider>,
  );

  return { onClose, onRsvp, onDelete, container: view.container };
}

describe("CalendarEventDetailsPopover", () => {
  beforeEach(() => {
    cleanup();
  });

  it("updates the when-row when preview form times change while open", { timeout: 10_000 }, () => {
    const base = resolveCalendarEventPreview("dentist", { events: bootstrap.data.events });
    expect(base).not.toBeNull();
    const { rerender } = render(
      <TooltipProvider delayDuration={0}>
        <CalendarEventDetailsPopover
          open
          preview={base!}
          calendars={bootstrap.data.calendars}
          labels={defaultCalendarLabels}
          locale="en-US"
          untitledLabel={defaultCalendarLabels.untitledEvent}
          canEdit
          onClose={vi.fn()}
        />
      </TooltipProvider>,
    );
    const initialWhen = formatEventPreviewWhen(base!.form, "en-US");
    expect(screen.getByText(initialWhen)).toBeTruthy();

    const moved = {
      ...base!,
      form: {
        ...base!.form,
        startTime: "15:00",
        endTime: "16:00",
      },
    };
    rerender(
      <TooltipProvider delayDuration={0}>
        <CalendarEventDetailsPopover
          open
          preview={moved}
          calendars={bootstrap.data.calendars}
          labels={defaultCalendarLabels}
          locale="en-US"
          untitledLabel={defaultCalendarLabels.untitledEvent}
          canEdit
          onClose={vi.fn()}
        />
      </TooltipProvider>,
    );
    const nextWhen = formatEventPreviewWhen(moved.form, "en-US");
    expect(nextWhen).not.toBe(initialWhen);
    expect(screen.getByText(nextWhen)).toBeTruthy();
    expect(screen.queryByText(initialWhen)).toBeNull();
  });

  it("shows a flow event-card with title, time, and Delete", { timeout: 10_000 }, () => {
    const { onDelete } = renderPopover({
      origin: { left: 48, top: 96, width: 180, height: 36 },
    });
    const popover = screen.getByRole("dialog", { name: /Dentist/i });
    expect(popover.className).toContain("calendar-event-details-popover");
    const eventCard = popover.querySelector("event-card.calendar-event-details-popover__event") as
      | (HTMLElement & { summary?: string; layout?: string })
      | null;
    expect(eventCard).toBeTruthy();
    expect(eventCard?.summary).toMatch(/Dentist/i);
    expect(eventCard?.layout).toBe("flow");
    expect(screen.queryByText("Personal")).toBeNull();
    expect(document.querySelector(".calendar-event-details-popover__calendar")).toBeNull();
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
    ).toBeNull();
    const remove = screen.getByRole("button", { name: defaultCalendarLabels.delete });
    expect(remove.className).toContain("button--severity-danger");
    fireEvent.click(remove);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("hosts the editable form when edit props are provided", { timeout: 10_000 }, () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onClose = vi.fn();
    const preview = resolveCalendarEventPreview("dentist", { events: bootstrap.data.events });
    expect(preview).not.toBeNull();
    renderPopover({
      preview,
      canEdit: true,
      edit: {
        form: preview!.form,
        onChange,
        onClose,
        onSave,
        onDelete: vi.fn(),
      },
    });
    const popover = screen.getByRole("dialog", { name: /Dentist/i });
    expect(popover.className).toContain("calendar-event-details-popover--editable");
    expect(popover.querySelector("event-card")).toBeNull();
    expect(screen.getByDisplayValue(preview!.form.title)).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.saveChanges })).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue(preview!.form.title), {
      target: { value: "Dentist visit" },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: "Dentist visit" }));
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.cancel }));
    expect(onClose).toHaveBeenCalled();
  });

  it("autofocuses the dialog root, not RSVP chrome", { timeout: 10_000 }, () => {
    const preview = {
      eventId: "awaiting-reply",
      form: {
        ...emptyCalendarEventForm("work", "2033-01-11"),
        title: "Partner sync",
        meetingUrl: "https://workspace.example.com/meet/guest?room=h8y8-ewp6-al8n",
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
    renderPopover({
      preview,
      calendars: bootstrap.data.calendars.map((calendar) =>
        calendar.id === "work" ? { ...calendar, mayShare: false, mayWrite: true } : calendar,
      ),
      sessionEmail: "me@example.test",
      workspaceOrigin: "https://workspace.example.com",
      onRsvp: vi.fn(),
      canEdit: false,
      onDelete: undefined,
    });
    const dialog = screen.getByRole("dialog", { name: /Partner sync/i });
    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(
      screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept }),
    );
    expect(document.activeElement).not.toBe(
      screen.getByRole("button", { name: defaultCalendarLabels.eventMeetJoin }),
    );
  });

  it("does not force Edit when the user cannot write", { timeout: 10_000 }, () => {
    renderPopover({ canEdit: false, onDelete: undefined });
    expect(screen.getByRole("dialog", { name: /Dentist/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.delete })).toBeNull();
  });

  it(
    "hides edit chrome on a read-only share even when canEdit is globally true",
    { timeout: 10_000 },
    () => {
      const preview = {
        eventId: "school-play",
        form: { ...emptyCalendarEventForm("family", "2033-01-14"), title: "School play" },
      };
      renderPopover({ preview, canEdit: true });
      expect(screen.getByRole("dialog", { name: /School play/i })).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: defaultCalendarLabels.delete })).toBeNull();
    },
  );

  it("hosts interactive create when edit.mode is create", { timeout: 10_000 }, () => {
    const form = emptyCalendarEventForm("default", "2033-01-12", "10:00");
    const onSave = vi.fn();
    renderPopover({
      canEdit: true,
      preview: { eventId: "", form },
      edit: {
        mode: "create",
        form,
        onChange: vi.fn(),
        onClose: vi.fn(),
        onSave,
      },
    });
    const popover = screen.getByRole("dialog");
    expect(popover.className).toContain("calendar-event-details-popover--editable");
    expect(popover.querySelector(".calendar-event-dialog__fields")).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.save })).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.delete })).toBeNull();
  });

  it(
    "hosts interactive edit for a group member who is not the organizer",
    { timeout: 10_000 },
    () => {
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
      const onSave = vi.fn();
      renderPopover({
        preview,
        sessionEmail: "me@example.test",
        canEdit: true,
        edit: {
          form: preview.form,
          onChange: vi.fn(),
          onClose: vi.fn(),
          onSave,
          onDelete: vi.fn(),
        },
      });
      expect(screen.getByDisplayValue("Desk review")).toBeTruthy();
      expect(screen.getByRole("button", { name: defaultCalendarLabels.saveChanges })).toBeTruthy();
    },
  );

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
      canEdit: false,
      onDelete: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept }));
    expect(onRsvp).toHaveBeenCalledWith("accepted");
    expect(screen.queryByRole("dialog", { name: defaultCalendarLabels.editEventTitle })).toBeNull();
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
    ).toBeNull();
  });

  it("hides RSVP when onRsvp is omitted even for an invitee", { timeout: 10_000 }, () => {
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
    renderPopover({
      preview,
      sessionEmail: "me@example.test",
      onRsvp: undefined,
      canEdit: false,
      onDelete: undefined,
    });
    expect(screen.getByRole("dialog", { name: /Partner sync/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.rsvpAccept })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.rsvpMaybe })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.rsvpDecline })).toBeNull();
  });

  it(
    "hosts interactive edit for a write-share recipient who is not the organizer",
    {
      timeout: 10_000,
    },
    () => {
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
        edit: {
          form: preview.form,
          onChange: vi.fn(),
          onClose: vi.fn(),
          onSave: vi.fn(),
          onDelete: vi.fn(),
        },
      });
      expect(screen.getByDisplayValue("Shared slot")).toBeTruthy();
      expect(screen.getByRole("button", { name: defaultCalendarLabels.saveChanges })).toBeTruthy();
    },
  );

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

  it("shows a primary Join button in the footer with Delete", { timeout: 10_000 }, () => {
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
    const primary = join.closest(".calendar-event-details-popover__footer-primary");
    const actions = screen
      .getByRole("button", { name: defaultCalendarLabels.delete })
      .closest(".calendar-event-details-popover__footer-actions");
    expect(primary).toBeTruthy();
    expect(actions).toBeTruthy();
    const footer = join.closest(".calendar-event-details-popover__footer");
    expect(footer).toBeTruthy();
    expect(
      primary!.compareDocumentPosition(actions!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(join);
    expect(onJoinMeeting).toHaveBeenCalledWith(href);
  });

  it("orders Join before RSVP in the primary footer cluster", { timeout: 10_000 }, () => {
    const href = "https://workspace.example.com/meet/guest?room=h8y8-ewp6-al8n";
    renderPopover({
      workspaceOrigin: "https://workspace.example.com",
      canEdit: false,
      onDelete: undefined,
      onRsvp: vi.fn(),
      sessionEmail: "me@example.test",
      preview: {
        eventId: "partner-meet",
        form: {
          ...emptyCalendarEventForm("work", "2033-01-11"),
          title: "Partner meet",
          meetingUrl: href,
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
      },
    });
    const join = screen.getByRole("button", { name: defaultCalendarLabels.eventMeetJoin });
    const accept = screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept });
    const primary = join.closest(".calendar-event-details-popover__footer-primary");
    expect(accept.closest(".calendar-event-details-popover__footer-primary")).toBe(primary);
    expect(
      primary!.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows alarms with a bell row on the event card", { timeout: 10_000 }, () => {
    renderPopover({
      preview: {
        eventId: "reminded",
        form: {
          ...emptyCalendarEventForm("default", "2033-01-12"),
          title: "Reminded",
          alerts: [{ id: "a1", action: "display", offset: "-PT15M" }],
        },
      },
    });
    expect(screen.getByText(/15 minutes/i)).toBeTruthy();
  });
});
