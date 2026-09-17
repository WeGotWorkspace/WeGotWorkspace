import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, Forward, Reply, Star, Trash2 } from "lucide-react";
import { ActionBar } from "../src/action-bar";

const meta: Meta<typeof ActionBar> = {
  title: "Shared/Action Bar",
  component: ActionBar,
  parameters: {
    docs: {
      description: {
        component:
          "Mobile back control uses outline Button chrome (same quiet border as peer actions). The More (`…`) menu appears only when a side has more than three actions (first three stay inline).",
      },
    },
  },
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

export const OverflowWhenMoreThanThree: Story = {
  name: "Overflow when more than three",
  args: {
    onBack: () => {},
    backLabel: "Inbox",
    rightActions: [
      { id: "reply", label: "Reply", onClick: () => {}, icon: <Reply /> },
      { id: "forward", label: "Forward", onClick: () => {}, icon: <Forward /> },
      { id: "star", label: "Star", onClick: () => {}, icon: <Star /> },
      { id: "archive", label: "Archive", onClick: () => {}, icon: <Archive /> },
      { id: "trash", label: "Trash", onClick: () => {}, icon: <Trash2 /> },
    ],
    rightMenuLabel: "More actions",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Five right actions: first three stay inline; Archive and Trash move into the More menu.",
      },
    },
  },
};

export const CustomOverflowIcons: Story = {
  args: {
    ...OverflowWhenMoreThanThree.args,
    rightMenuIcon: <Star />,
  },
};
