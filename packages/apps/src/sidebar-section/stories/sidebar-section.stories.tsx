import type { Meta, StoryObj } from "@storybook/react-vite";
import { Folder, Tag } from "lucide-react";
import { SidebarSection } from "../src/sidebar-section";

const meta: Meta<typeof SidebarSection> = {
  title: "UI/Patterns/Sidebar Section",
  component: SidebarSection,
};

export default meta;
type Story = StoryObj<typeof SidebarSection>;

export const Default: Story = {
  args: {
    title: "Mailboxes",
    items: [
      {
        label: "Inbox",
        icon: <Folder className="size-3.5" />,
        selected: true,
        badge: 12,
        onClick: () => {},
      },
      {
        label: "Tags",
        icon: <Tag className="size-3.5" />,
        selected: false,
        onClick: () => {},
      },
    ],
  },
};

export const WithAddButton: Story = {
  args: {
    ...Default.args,
    onAdd: () => {},
    addLabel: "Add mailbox",
  },
};

export const Untitled: Story = {
  args: {
    ...Default.args,
    title: undefined,
    onAdd: () => {},
    addLabel: "Add mailbox",
  },
};
