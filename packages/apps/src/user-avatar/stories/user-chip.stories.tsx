import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Check } from "lucide-react";

import { TooltipProvider } from "@/ui/tooltip";
import { UserChip } from "../src/user-chip";

const meta: Meta<typeof UserChip> = {
  title: "UI/Primitives/User Chip",
  component: UserChip,
  decorators: [
    (Story) => (
      <TooltipProvider delayDuration={0}>
        <Story />
      </TooltipProvider>
    ),
  ],
  argTypes: {
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof UserChip>;

export const Default: Story = {
  args: {
    label: "Ada Pereira",
  },
  tags: ["vitest-ci"],
};

export const WithStatus: Story = {
  args: {
    label: "Ada Pereira",
    statusLabel: "Organizer",
    markIcon: <Check className="size-3" aria-hidden />,
  },
  tags: ["vitest-ci"],
};

export const Removable: Story = {
  args: {
    label: "Ada Pereira",
    removable: true,
    onRemove: fn(),
    removeAriaLabel: "Remove Ada Pereira",
  },
  tags: ["vitest-ci"],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Remove Ada Pereira" }));
    await expect(args.onRemove).toHaveBeenCalled();
  },
};
