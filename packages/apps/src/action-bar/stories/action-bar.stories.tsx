import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, Download, Forward, Pencil, Reply, Star, Trash2 } from "lucide-react";
import { ActionBar } from "../src/action-bar";

const meta: Meta<typeof ActionBar> = {
  title: "UI/Patterns/Action Bar",
  component: ActionBar,
  parameters: {
    docs: {
      description: {
        component:
          "Mobile back control uses outline Button chrome (same quiet border as peer actions). Actions past the first three move into the More (`…`) menu. Actions marked collapseOnNarrow stay inline on a wide bar and move into that menu below 768px.",
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

export const CollapseOnNarrow: Story = {
  name: "Collapse on narrow",
  globals: {
    viewport: { value: "mobile1", isRotated: false },
  },
  args: {
    onBack: () => {},
    backLabel: "Contacts",
    rightActions: [
      {
        id: "edit",
        label: "Edit",
        onClick: () => {},
        icon: <Pencil />,
        showLabel: true,
        iconOnlyOnNarrow: true,
      },
      {
        id: "download",
        label: "Download",
        onClick: () => {},
        icon: <Download />,
        collapseOnNarrow: true,
      },
      {
        id: "delete",
        label: "Delete",
        onClick: () => {},
        icon: <Trash2 />,
        severity: "danger",
        collapseOnNarrow: true,
      },
    ],
    rightMenuLabel: "More actions",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Small-screen viewport. Download and Delete leave the bar and appear in More. Edit keeps its pencil and drops the visible label; the accessible name stays Edit.",
      },
    },
  },
};
