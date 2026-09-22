import type { Meta, StoryObj } from "@storybook/react-vite";
import { defaultOfflineLabels } from "@/lib/offline/offline-labels";
import { OfflineStatusIndicator } from "@/lib/offline/offline-status-indicator";

const meta = {
  title: "UI/Patterns/Offline Status Indicator",
  component: OfflineStatusIndicator,
  tags: ["vitest-ci"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Bottom-right pill with an amber status dot and warm tinted background. Hidden when online.",
      },
    },
  },
  argTypes: {
    message: { control: "text" },
    className: { control: false },
    online: { control: "boolean" },
  },
} satisfies Meta<typeof OfflineStatusIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Offline: Story = {
  args: {
    online: false,
    message: defaultOfflineLabels.statusMessage,
  },
  parameters: {
    docs: {
      description: {
        story: "Amber dot pulses subtly; pill stays fixed in the bottom-right corner.",
      },
    },
  },
};

export const CustomMessage: Story = {
  args: {
    online: false,
    message: "Offline — edits queue until you're back online",
  },
};
