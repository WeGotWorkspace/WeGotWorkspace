import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, Forward, Reply, Star } from "lucide-react";
import { ActionBar } from "../src/action-bar";

const meta: Meta<typeof ActionBar> = {
  title: "Shared/Action Bar",
  component: ActionBar,
};

export default meta;
type Story = StoryObj<typeof ActionBar>;

export const MailLike: Story = {
  args: {
    onBack: () => {},
    backLabel: "Inbox",
    leftActions: [
      { id: "reply", label: "Reply", onClick: () => {}, icon: <Reply /> },
      { id: "forward", label: "Forward", onClick: () => {}, icon: <Forward /> },
    ],
    rightActions: [
      { id: "star", label: "Star", onClick: () => {}, icon: <Star /> },
      { id: "archive", label: "Archive", onClick: () => {}, icon: <Archive /> },
    ],
    leftMenuLabel: "Reply options",
    leftMenuIcon: <Reply />,
    rightMenuLabel: "More actions",
  },
};

export const NotesLike: Story = {
  args: {
    onBack: () => {},
    backLabel: "All Items",
    rightActions: [
      { id: "star", label: "Star", onClick: () => {}, icon: <Star /> },
      { id: "archive", label: "Archive", onClick: () => {}, icon: <Archive /> },
    ],
    rightMenuLabel: "More actions",
  },
};

export const CompactOverflow: Story = {
  args: {
    ...MailLike.args,
  },
  globals: {
    viewport: {
      value: "mobile1",
      isRotated: false,
    },
  },
};

export const CustomOverflowIcons: Story = {
  args: {
    ...MailLike.args,
    leftMenuIcon: <Forward />,
    rightMenuIcon: <Star />,
  },
  globals: {
    viewport: {
      value: "mobile1",
      isRotated: false,
    },
  },
};
