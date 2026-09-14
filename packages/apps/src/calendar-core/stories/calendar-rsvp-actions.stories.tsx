import { useEffect, useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarRsvpActions, CalendarRsvpSelect } from "@/calendar-core/src/calendar-rsvp-actions";

const meta: Meta<typeof CalendarRsvpActions> = {
  title: "Apps/Calendar/RsvpActions",
  component: CalendarRsvpActions,
  args: {
    labels: defaultCalendarLabels,
    onRespond: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarRsvpActions>;

function InteractiveRsvp(args: ComponentProps<typeof CalendarRsvpActions>) {
  const [status, setStatus] = useState(args.currentStatus);
  useEffect(() => {
    setStatus(args.currentStatus);
  }, [args.currentStatus]);
  return (
    <CalendarRsvpActions
      {...args}
      currentStatus={status}
      onRespond={(next) => {
        setStatus(next);
        void args.onRespond(next);
      }}
    />
  );
}

export const NeedsAction: Story = {
  args: { currentStatus: "needs-action" },
  tags: ["vitest-ci"],
  render: (args) => <InteractiveRsvp {...args} />,
};

export const Accepted: Story = {
  args: { currentStatus: "accepted" },
  render: (args) => <InteractiveRsvp {...args} />,
};

export const Maybe: Story = {
  args: { currentStatus: "tentative" },
  render: (args) => <InteractiveRsvp {...args} />,
};

export const Declined: Story = {
  args: { currentStatus: "declined" },
  render: (args) => <InteractiveRsvp {...args} />,
};

export const SelectRespond: Story = {
  render: () => <CalendarRsvpSelect labels={defaultCalendarLabels} onChange={fn()} />,
};

export const SelectAccepted: Story = {
  render: () => (
    <CalendarRsvpSelect value="accepted" labels={defaultCalendarLabels} onChange={fn()} />
  ),
};

export const SelectMaybe: Story = {
  render: () => (
    <CalendarRsvpSelect value="tentative" labels={defaultCalendarLabels} onChange={fn()} />
  ),
};

export const SelectDeclined: Story = {
  render: () => (
    <CalendarRsvpSelect value="declined" labels={defaultCalendarLabels} onChange={fn()} />
  ),
};
