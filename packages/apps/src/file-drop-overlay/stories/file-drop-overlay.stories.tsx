import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileDropOverlay } from "@/file-drop-overlay/src/file-drop-overlay";

const meta = {
  title: "UI/Patterns/File Drop Overlay",
  component: FileDropOverlay,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  render: (args) => (
    <div className="relative h-64 w-full bg-[color-mix(in_oklab,var(--color-we-got-dark)_6%,transparent)]">
      <FileDropOverlay {...args} />
    </div>
  ),
} satisfies Meta<typeof FileDropOverlay>;

export default meta;
type Story = StoryObj<typeof FileDropOverlay>;

export const Default: Story = {
  args: {
    children: "Drop files to upload to My Drive",
  },
};
