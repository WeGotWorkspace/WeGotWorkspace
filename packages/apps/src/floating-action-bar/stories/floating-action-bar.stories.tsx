import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, CheckCircle2, FolderInput, Star } from "lucide-react";
import { FloatingActionBar } from "@/floating-action-bar/src/floating-action-bar";

const meta: Meta<typeof FloatingActionBar> = {
  title: "Shared/Floating Action Bar",
  component: FloatingActionBar,
};

export default meta;
type Story = StoryObj<typeof FloatingActionBar>;

export const Default: Story = {
  args: {
    items: 5,
    buttons: [
      { label: "Star", icon: <Star className="size-4" />, onClick: () => {} },
      { label: "Archive", icon: <Archive className="size-4" />, onClick: () => {} },
      { label: "Move", icon: <FolderInput className="size-4" />, onClick: () => {} },
      { label: "Done", icon: <CheckCircle2 className="size-4" />, onClick: () => {} },
    ],
  },
  render: (args) => (
    <div className="relative h-36">
      <FloatingActionBar {...args} />
    </div>
  ),
};
