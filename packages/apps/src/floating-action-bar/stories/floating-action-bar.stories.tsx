import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, CheckCircle2, FolderInput, Star } from "lucide-react";
import { FloatingActionBar } from "@/floating-action-bar/src/floating-action-bar";
import "@/floating-action-bar/stories/floating-action-bar.stories.css";

const meta: Meta<typeof FloatingActionBar> = {
  title: "Shared/Floating Action Bar",
  component: FloatingActionBar,
};

export default meta;
type Story = StoryObj<typeof FloatingActionBar>;

const defaultButtons = [
  { label: "Star", icon: <Star className="size-4" />, onClick: () => {} },
  { label: "Archive", icon: <Archive className="size-4" />, onClick: () => {} },
  { label: "Move", icon: <FolderInput className="size-4" />, onClick: () => {} },
  { label: "Done", icon: <CheckCircle2 className="size-4" />, onClick: () => {} },
];

export const Default: Story = {
  args: {
    items: 5,
    buttons: defaultButtons,
  },
  render: (args) => (
    <div className="floating-action-bar-story--drive relative h-36">
      <FloatingActionBar {...args} />
    </div>
  ),
};

export const DocsAccent: Story = {
  args: {
    items: 2,
    buttons: defaultButtons,
  },
  render: (args) => (
    <div className="floating-action-bar-story--docs relative h-36">
      <FloatingActionBar {...args} />
    </div>
  ),
};
