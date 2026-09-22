import { useEffect, useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarRsvpActions, CalendarRsvpSelect } from "@/calendar-core/src/calendar-rsvp-actions";

const meta: Meta<typeof CalendarRsvpActions> = {
  title: "Shared/Calendar/RsvpActions",
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvasElement.querySelector(".segmented-control");
    await expect(root?.classList.contains("segmented-control--unselected")).toBe(true);
    await expect(canvasElement.querySelector(".segmented-control__button--active")).toBeNull();
    for (const name of [
      defaultCalendarLabels.rsvpAccept,
      defaultCalendarLabels.rsvpMaybe,
      defaultCalendarLabels.rsvpDecline,
    ]) {
      const button = canvas.getByRole("button", { name });
      await expect(button).not.toHaveAttribute("aria-pressed", "true");
      await expect(button.classList.contains("segmented-control__button--text")).toBe(false);
      await expect(button).not.toHaveTextContent(name);
      await expect(button.querySelector("svg")).toBeTruthy();
    }
  },
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

export const LabeledSm: Story = {
  args: { currentStatus: "needs-action", size: "sm", showLabels: true },
  tags: ["vitest-ci"],
  render: (args) => <InteractiveRsvp {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvasElement.querySelector(".segmented-control");
    await expect(root?.classList.contains("segmented-control--size-md")).toBe(true);
    for (const name of [
      defaultCalendarLabels.rsvpAccept,
      defaultCalendarLabels.rsvpMaybe,
      defaultCalendarLabels.rsvpDecline,
    ]) {
      const button = canvas.getByRole("button", { name });
      await expect(button.classList.contains("segmented-control__button--text")).toBe(true);
      await expect(button).toHaveTextContent(name);
      await expect(button.querySelector("svg")).toBeTruthy();
    }
  },
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
