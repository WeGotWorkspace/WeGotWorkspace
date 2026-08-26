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
    onEdit: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarEventDetailsPopover>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const heading = canvas.getByRole("heading", { name: "Lunch" });
    await expect(heading).toBeTruthy();
    await expect(heading.querySelector(".calendar-event-details-popover__swatch")).toBeTruthy();
    await expect(canvas.queryByText("Personal")).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
    );
    await expect(args.onEdit).toHaveBeenCalled();
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
