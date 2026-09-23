import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, Inbox, Send } from "lucide-react";
import { ContentLabel } from "../src/content-label";

const meta: Meta<typeof ContentLabel> = {
  title: "UI/Primitives/Content Label",
  component: ContentLabel,
  tags: ["vitest-ci"],
};

export default meta;
type Story = StoryObj<typeof ContentLabel>;

export const MailboxInbox: Story = {
  args: {
    text: "Inbox",
    icon: <Inbox className="size-3.5" />,
    style: {
      color: "var(--color-emerald)",
      backgroundColor: "color-mix(in oklab, var(--color-emerald) 16%, transparent)",
    },
  },
};

export const MailboxArchive: Story = {
  args: {
    text: "Archive",
    icon: <Archive className="size-3.5" />,
  },
};

export const CustomLongText: Story = {
  args: {
    text: "Sent to external account",
    icon: <Send className="size-3.5" />,
    className: "max-w-[220px]",
  },
};
