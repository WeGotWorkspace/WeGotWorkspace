import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CalendarRsvpSelect } from "@/calendar-core/src/calendar-rsvp-actions";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";

const meta: Meta<typeof CalendarRsvpSelect> = {
  title: "Apps/Calendar/RsvpSelect",
  component: CalendarRsvpSelect,
  args: {
    labels: defaultCalendarLabels,
    onChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarRsvpSelect>;

export const Respond: Story = {
  tags: ["vitest-ci"],
};

export const Accepted: Story = {
  args: { value: "accepted" },
};

export const Maybe: Story = {
  args: { value: "tentative" },
};

export const Declined: Story = {
  args: { value: "declined" },
};
