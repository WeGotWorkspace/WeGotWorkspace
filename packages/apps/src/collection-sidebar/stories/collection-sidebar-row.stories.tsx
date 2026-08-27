import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CollectionSidebarRow } from "@/collection-sidebar/src/collection-sidebar-row";

const meta: Meta<typeof CollectionSidebarRow> = {
  title: "Shared/CollectionSidebarRow",
  component: CollectionSidebarRow,
  tags: ["autodocs"],
  args: {
    name: "Work",
    color: "#0ea5e9",
    visible: true,
    selected: true,
    onSelect: fn(),
    onToggleVisibility: fn(),
    onEdit: fn(),
    editLabel: "Edit",
  },
  render: (args) => (
    <ul className="max-w-xs p-4">
      <CollectionSidebarRow {...args} />
    </ul>
  ),
};

export default meta;
type Story = StoryObj<typeof CollectionSidebarRow>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Work" }));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onToggleVisibility).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("checkbox", { name: "Hide Work" }));
    await expect(args.onToggleVisibility).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledOnce();
  },
};

export const NoCheckbox: Story = {
  args: {
    onToggleVisibility: undefined,
    showColorDot: true,
    selected: false,
  },
};
