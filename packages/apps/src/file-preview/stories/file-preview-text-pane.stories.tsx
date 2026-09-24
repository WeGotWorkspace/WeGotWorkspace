import type { Meta, StoryObj } from "@storybook/react-vite";
import { FilePreviewTextPane } from "@/file-preview/src/file-preview-text-pane";
import "@/file-preview/src/file-preview-text-pane.css";

const meta = {
  title: "UI/Patterns/File Preview Text Pane",
  component: FilePreviewTextPane,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="drive-workspace h-36 w-64 border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FilePreviewTextPane>;

export default meta;
type Story = StoryObj<typeof FilePreviewTextPane>;

const SAMPLE =
  "Meeting notes from Tuesday. We agreed to ship grid previews first, then wire column view in follow-up phases.";

export const ClampedTile: Story = {
  name: "Clamped (grid tile)",
  args: {
    content: SAMPLE,
    mode: "clamped",
  },
};

export const ScrollablePane: Story = {
  name: "Scrollable (detail pane)",
  decorators: [
    (Story) => (
      <div className="drive-workspace h-48 w-80 border">
        <Story />
      </div>
    ),
  ],
  args: {
    content: `${SAMPLE}\n\nAdditional paragraphs appear here when the preview surface allows scrolling instead of line clamping.`,
    mode: "scrollable",
  },
};

export const Empty: Story = {
  name: "Empty content",
  args: {
    content: "   ",
    mode: "clamped",
  },
};
