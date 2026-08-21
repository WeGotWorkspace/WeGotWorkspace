import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CalendarRsvpView } from "@/calendar-core/src/calendar-rsvp-page";

const meta: Meta<typeof CalendarRsvpView> = {
  title: "Apps/Calendar/RsvpPage",
  component: CalendarRsvpView,
  args: {
    title: "External Sync",
    attendeeEmail: "guest@elsewhere.test",
    participationStatus: "needs-action",
    onRespond: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarRsvpView>;

export const Default: Story = {
  tags: ["vitest-ci"],
};
