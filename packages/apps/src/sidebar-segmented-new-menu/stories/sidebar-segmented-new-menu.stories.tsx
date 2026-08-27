import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";

const meta: Meta<typeof SidebarSegmentedNewMenu> = {
  title: "Shared/SidebarSegmentedNewMenu",
  component: SidebarSegmentedNewMenu,
  tags: ["autodocs"],
  args: {
    mainLabel: "New event",
    menuLabel: "More create actions",
    onMainAction: fn(),
    items: [
      { id: "create-calendar", label: "Add calendar", onClick: fn() },
      { id: "subscribe", label: "Subscribe", onClick: fn() },
    ],
  },
  render: (args) => (
    <div className="max-w-xs p-6">
      <SidebarSegmentedNewMenu {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof SidebarSegmentedNewMenu>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "New event" }));
    await expect(args.onMainAction).toHaveBeenCalledOnce();
  },
};

export const MainOnly: Story = {
  args: {
    items: [],
  },
};
