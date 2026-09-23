import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Folder, Star } from "lucide-react";
import { MenuItem } from "../src/menu-item";

const meta: Meta<typeof MenuItem> = {
  title: "UI/Primitives/Menu Item",
  component: MenuItem,
  tags: ["vitest-ci"],
};

export default meta;
type Story = StoryObj<typeof MenuItem>;

export const Default: Story = {
  args: {
    label: "Inbox",
    icon: <Folder className="size-3.5" />,
    onClick: fn(),
    selected: false,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const item = canvas.getByRole("button", { name: "Inbox" });
    item.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const SelectedWithBadge: Story = {
  args: {
    label: "Starred",
    icon: <Star className="size-3.5" />,
    badge: 7,
    onClick: () => {},
    selected: true,
  },
};

export const WithDescription: Story = {
  args: {
    label: "Disk space",
    description: "42.1 GB free of 100 GB",
    icon: <Folder className="size-4" />,
  },
};
