import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocsFilePreview } from "@/docs-core/src/docs-file-preview";
import { FilePreviewTextPane } from "@/file-preview/src/file-preview-text-pane";
import "@/docs-core/src/docs-file-preview.css";
import "@/file-preview/src/file-preview-text-pane.css";
import "@/drive-core/src/drive-browser.css";

const SAMPLE_MARKDOWN = `# Drive preview

This **markdown** document renders with the Docs editor in read-only mode.

## Overview

Grid tiles show a miniature of the full letter-sized page, scaled down so headings, lists, and body copy remain recognizable at a glance.

- Rich formatting
- Lists and headings
- Same serializer as the Docs workspace

## Details

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

> A blockquote adds visual variety on the thumbnail page.

1. Numbered lists
2. Scale to fit the 16:9 tile
3. Overflow clipped at the bottom edge
`;

const meta = {
  title: "Shared/Docs/DocsFilePreview",
  component: DocsFilePreview,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="drive-workspace w-[28rem]">
        <div className="drive-detail-panel__preview relative aspect-[4/3] overflow-hidden">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof DocsFilePreview>;

export default meta;
type Story = StoryObj<typeof DocsFilePreview>;

export const MarkdownReadOnly: Story = {
  name: "Markdown (read-only)",
  args: {
    fileName: "Spec.md",
    content: SAMPLE_MARKDOWN,
    fallback: <FilePreviewTextPane content="Fallback text preview" mode="scrollable" />,
  },
};

export const PlainTextReadOnly: Story = {
  name: "Plain text (read-only)",
  args: {
    fileName: "notes.txt",
    content: "Plain text files use the text serializer without the format bar.",
    fallback: <FilePreviewTextPane content="Fallback text preview" mode="scrollable" />,
  },
};

export const TileMarkdownReadOnly: Story = {
  name: "Grid tile (read-only)",
  decorators: [
    (Story) => (
      <div className="drive-workspace w-64">
        <div className="drive-file-tile__preview relative aspect-[16/9]">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    fileName: "Spec.md",
    content: SAMPLE_MARKDOWN,
    variant: "tile",
    fallback: <FilePreviewTextPane content="Fallback text preview" mode="clamped" />,
  },
};
