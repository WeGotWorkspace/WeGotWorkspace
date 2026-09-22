import type { Meta, StoryObj } from "@storybook/react-vite";
import { Cloud } from "lucide-react";
import { CollectionState } from "@/collection-state/src/collection-state";

const meta = {
  title: "UI/Patterns/Collection State",
  component: CollectionState,
  tags: ["autodocs"],
} satisfies Meta<typeof CollectionState>;

export default meta;
type Story = StoryObj<typeof CollectionState>;

export const EmptyFolder: Story = {
  name: "Empty folder",
  args: {
    icon: <Cloud className="size-12" />,
    children: "This folder is empty",
  },
};

export const Loading: Story = {
  args: {
    variant: "loading",
    children: "Loading folder…",
  },
};
