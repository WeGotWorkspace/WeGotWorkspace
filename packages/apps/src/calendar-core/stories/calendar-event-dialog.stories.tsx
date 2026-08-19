import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CalendarEventDialog } from "@/calendar-core/src/calendar-event-dialog";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";

const bootstrap = createCalendarAppBootstrap();

const meta: Meta<typeof CalendarEventDialog> = {
  title: "Apps/Calendar/EventDialog",
  component: CalendarEventDialog,
  args: {
    open: true,
    mode: "create",
    form: { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" },
    calendars: bootstrap.data.calendars,
    labels: defaultCalendarLabels,
    locale: "en-US",
    canSubmitEmail: true,
    onChange: fn(),
    onClose: fn(),
    onSave: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarEventDialog>;

export const Default: Story = {
  tags: ["vitest-ci"],
};

export const EmailUnavailable: Story = {
  args: {
    canSubmitEmail: false,
  },
};

export const WithInvitees: Story = {
  args: {
    invitees: [
      { username: "wouter", email: "wouter@woutervroege.nl", name: "Wouter" },
      { username: "carol", email: "carol@example.test", name: "Carol" },
    ],
    sessionEmail: "admin@localhost",
    form: {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      attendees: [
        {
          email: "wouter@woutervroege.nl",
          name: "Wouter",
          participationStatus: "tentative",
          role: "required",
        },
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "accepted",
          role: "required",
        },
        {
          email: "dana@example.test",
          name: "Dana",
          participationStatus: "declined",
          role: "optional",
        },
        {
          email: "guest@elsewhere.test",
          name: "guest@elsewhere.test",
          participationStatus: "needs-action",
          role: "optional",
        },
      ],
    },
  },
};
