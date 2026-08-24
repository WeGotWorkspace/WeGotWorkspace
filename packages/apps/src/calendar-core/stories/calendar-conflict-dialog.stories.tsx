import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent } from "storybook/test";
import { CalendarConflictDialog } from "@/calendar-core/src/calendar-conflict-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";

const meta = {
  title: "Apps/Calendar/Conflict Dialog",
  component: CalendarConflictDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    eventTitle: "Team standup",
    labels: defaultCalendarLabels,
    onKeepLocal: fn(),
    onUseServer: fn(),
    onOpenChange: fn(),
  },
} satisfies Meta<typeof CalendarConflictDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args }) => {
    await expect(await screen.findByText("Sync conflict")).toBeInTheDocument();
    const keepMine = screen.getByRole("button", { name: "Keep mine" });
    const useServer = screen.getByRole("button", { name: "Use server" });
    await expect(keepMine).toBeInTheDocument();
    await expect(useServer).toBeInTheDocument();
    await userEvent.click(keepMine);
    await expect(args.onKeepLocal).toHaveBeenCalledTimes(1);
    await userEvent.click(useServer);
    await expect(args.onUseServer).toHaveBeenCalledTimes(1);
  },
};

export const WithQueue: Story = {
  args: {
    remainingCount: 2,
  },
};
