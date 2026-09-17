import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CalendarEventDetailsPopover } from "@/calendar-core/src/calendar-event-details-popover";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";

const bootstrap = createCalendarAppBootstrap();

const lunchForm = {
  ...emptyCalendarEventForm("default", "2033-01-12"),
  title: "Lunch",
  location: "Cafe",
  description: "Bring laptop",
  startTime: "12:00",
  endTime: "13:00",
};

const meta: Meta<typeof CalendarEventDetailsPopover> = {
  title: "Apps/Calendar/EventDetailsPopover",
  component: CalendarEventDetailsPopover,
  args: {
    open: true,
    preview: { eventId: "lunch", form: lunchForm },
    calendars: bootstrap.data.calendars,
    labels: defaultCalendarLabels,
    locale: "en-US",
    untitledLabel: defaultCalendarLabels.untitledEvent,
    canEdit: true,
    origin: { left: 72, top: 96, width: 168, height: 40 },
    onClose: fn(),
    onDelete: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarEventDetailsPopover>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const popover = canvas.getByRole("dialog", { name: "Lunch" });
    await expect(popover).toBeTruthy();
    const eventCard = popover.querySelector("event-card.calendar-event-details-popover__event") as
      | (HTMLElement & { summary?: string })
      | null;
    await expect(eventCard).toBeTruthy();
    await expect(eventCard?.summary).toBe("Lunch");
    await expect(popover.querySelector(".calendar-event-details-popover__details")).toBeTruthy();
    await expect(canvas.getByText("Cafe")).toBeTruthy();
    await expect(canvas.getByText("Bring laptop")).toBeTruthy();
    await userEvent.click(canvas.getByRole("button", { name: defaultCalendarLabels.delete }));
    await expect(args.onDelete).toHaveBeenCalled();
  },
};

export const InteractiveEdit: Story = {
  tags: ["vitest-ci"],
  args: {
    // Card-sized week/day origin — not a compact-month cell — so the popover
    // stays undocked and hosts the shared single-column event form.
    origin: { left: 120, top: 72, width: 220, height: 48 },
    edit: {
      form: lunchForm,
      onChange: fn(),
      onClose: fn(),
      onSave: fn(),
      onDelete: fn(),
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const popover = canvas.getByRole("dialog", { name: "Lunch" });
    await expect(popover.className).toContain("calendar-event-details-popover--editable");
    await expect(popover.className).toContain("calendar-event-dialog");
    await expect(popover.className).not.toContain("calendar-event-details-popover--docked");
    await expect(popover.querySelector(".calendar-event-dialog__fields")).toBeTruthy();
    await expect(popover.querySelector(".field-label-row--icon")).toBeTruthy();
    await expect(canvas.getByDisplayValue("Lunch")).toBeTruthy();
    // Shared control chrome: Input / Select / Textarea / LocaleDatePicker / Button (sm).
    await expect(popover.querySelector(".input")).toBeTruthy();
    await expect(popover.querySelector(".input--size-sm")).toBeTruthy();
    await expect(popover.querySelector(".select-trigger")).toBeTruthy();
    await expect(popover.querySelector(".select-trigger--size-sm")).toBeTruthy();
    await expect(popover.querySelector(".textarea")).toBeTruthy();
    await expect(popover.querySelector(".control-surface.locale-date-picker")).toBeTruthy();
    await expect(popover.querySelector(".control-surface--size-sm")).toBeTruthy();
    const remove = canvas.getByRole("button", { name: defaultCalendarLabels.delete });
    await expect(remove.className).toContain("button--severity-danger");
    await expect(remove.className).toContain("button--variant-outline");
    await expect(
      canvas.getByRole("button", { name: defaultCalendarLabels.saveChanges }),
    ).toBeTruthy();
    await userEvent.click(canvas.getByRole("button", { name: defaultCalendarLabels.cancel }));
    await expect(args.edit?.onClose).toHaveBeenCalled();
  },
};

/** Narrow viewport still uses the same single-column event form. */
export const InteractiveEditMobile: Story = {
  args: {
    origin: { left: 24, top: 64, width: 160, height: 40 },
    edit: {
      form: lunchForm,
      onChange: fn(),
      onClose: fn(),
      onSave: fn(),
      onDelete: fn(),
    },
  },
  globals: {
    viewport: { value: "mobile2", isRotated: false },
  },
};

export const TallWeekSegment: Story = {
  tags: ["vitest-ci"],
  args: {
    origin: { left: 420, top: 160, width: 168, height: 420 },
    preview: {
      eventId: "two",
      form: {
        ...lunchForm,
        title: "Two",
        startDate: "2026-08-20",
        startTime: "14:00",
        endDate: "2026-08-21",
        endTime: "15:45",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const popover = canvas.getByRole("dialog", { name: "Two" });
    await expect(popover.className).toContain("calendar-event-details-popover");
    await expect(popover.className).not.toContain("calendar-event-details-popover--docked");
  },
};

export const MeetJoin: Story = {
  args: {
    workspaceOrigin: "https://workspace.example.com",
    onJoinMeeting: fn(),
    meetOperations: {
      roomStatus: async () => ({ reserved: true, active: false }),
    },
    preview: {
      eventId: "standup",
      form: {
        ...lunchForm,
        title: "Standup",
        meetingUrl: "https://workspace.example.com/meet/guest?room=h8y8-ewp6-al8n",
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const join = canvas.getByRole("button", { name: defaultCalendarLabels.eventMeetJoin });
    const remove = canvas.getByRole("button", { name: defaultCalendarLabels.delete });
    await expect(join.className).toContain("button--variant-primary");
    const primary = join.closest(".calendar-event-details-popover__footer-primary");
    const actions = remove.closest(".calendar-event-details-popover__footer-actions");
    await expect(primary).toBeTruthy();
    await expect(actions).toBeTruthy();
    await expect(
      primary!.compareDocumentPosition(actions!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await userEvent.click(join);
    await expect(args.onJoinMeeting).toHaveBeenCalled();
  },
};

export const MeetDeadLink: Story = {
  args: {
    workspaceOrigin: "https://workspace.example.com",
    meetOperations: {
      roomStatus: async () => ({ reserved: false, active: false }),
    },
    preview: {
      eventId: "swept",
      form: {
        ...lunchForm,
        title: "Swept room",
        meetingUrl: "https://workspace.example.com/meet/guest?room=dead-link-aaaa",
      },
    },
  },
};

export const InviteeRsvp: Story = {
  args: {
    sessionEmail: "carol@example.test",
    onRsvp: fn(),
    canEdit: false,
    preview: {
      eventId: "standup",
      form: {
        ...lunchForm,
        title: "Standup",
        attendees: [
          {
            email: "bob@example.test",
            name: "Bob",
            participationStatus: "accepted",
            isOrganizer: true,
          },
          {
            email: "carol@example.test",
            name: "Carol",
            participationStatus: "needs-action",
          },
        ],
      },
    },
  },
};
