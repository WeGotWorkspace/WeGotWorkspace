import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarNewMenu } from "@/calendar-core/src/calendar-new-menu";
import "@/calendar-core/src/calendar-workspace.css";

const meta: Meta<typeof CalendarNewMenu> = {
  title: "Apps/Calendar/Components/CalendarNewMenu",
  component: CalendarNewMenu,
  tags: ["autodocs"],
  args: {
    labels: defaultCalendarLabels,
    onCreateEvent: fn(),
    onCreateCalendar: fn(),
    onSubscribeCalendar: fn(),
  },
  render: (args) => (
    <div className="calendar-workspace max-w-xs p-6">
      <CalendarNewMenu {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof CalendarNewMenu>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: defaultCalendarLabels.newEvent }));
    await expect(args.onCreateEvent).toHaveBeenCalledOnce();

    await userEvent.click(canvas.getByRole("button", { name: defaultCalendarLabels.newEventMenu }));
    await userEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.createCalendar }),
    );
    await expect(args.onCreateCalendar).toHaveBeenCalledOnce();

    await userEvent.click(canvas.getByRole("button", { name: defaultCalendarLabels.newEventMenu }));
    await userEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.subscribeCalendar }),
    );
    await expect(args.onSubscribeCalendar).toHaveBeenCalledOnce();
  },
};

export const EventOnly: Story = {
  args: {
    onCreateCalendar: undefined,
    onSubscribeCalendar: undefined,
  },
};
