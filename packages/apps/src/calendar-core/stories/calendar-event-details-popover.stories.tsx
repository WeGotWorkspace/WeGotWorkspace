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
    await expect(canvas.getByRole("heading", { name: "Lunch" })).toBeTruthy();
    await userEvent.click(
      canvas.getByRole("button", { name: defaultCalendarLabels.eventDetailsEdit }),
    );
    await expect(args.onEdit).toHaveBeenCalled();
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
