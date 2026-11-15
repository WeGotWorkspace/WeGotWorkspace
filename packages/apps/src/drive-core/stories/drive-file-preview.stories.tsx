import type { Meta, StoryObj } from "@storybook/react-vite";
import { FilePreview } from "@/file-preview/src/file-preview";
import "@/file-preview/src/file-preview.css";
import "@/drive-core/src/drive-browser.css";

const SAMPLE_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='120' height='80' fill='%2322c55e'/%3E%3C/svg%3E";

const meta = {
  title: "UI/Patterns/File Preview",
  component: FilePreview,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="drive-workspace w-64">
        <div className="drive-file-tile__preview relative">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof FilePreview>;

export default meta;
type Story = StoryObj<typeof FilePreview>;

export const ImageBlobUrl: Story = {
  name: "Image (blob URL)",
  args: {
    fileKind: "image",
    fileName: "cover.png",
    preview: { kind: "blob-url", url: SAMPLE_IMAGE },
    mediaClassName: "h-full w-full object-cover",
  },
};

export const VideoBlobUrl: Story = {
  name: "Video (blob URL, muted tile)",
  args: {
    fileKind: "video",
    fileName: "clip.mp4",
    preview: {
      kind: "blob-url",
      url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    },
    mediaClassName: "h-full w-full object-cover",
  },
};

export const TextExcerpt: Story = {
  name: "Text excerpt (tile)",
  args: {
    fileKind: "doc",
    fileName: "Roadmap.md",
    preview: {
      kind: "text",
      content:
        "Q3 goals include offline docs, shared previews, and a faster search index rollout across all workspaces.",
    },
    textMode: "clamped",
  },
};

export const MarkdownRichTile: Story = {
  name: "Markdown rich preview (tile)",
  args: {
    fileKind: "doc",
    fileName: "Roadmap.md",
    preview: {
      kind: "docs",
      content:
        "# Roadmap\n\nShip **grid tile** markdown previews with lazy-mounted read-only Docs editor.",
    },
    textMode: "clamped",
  },
};

export const UnsupportedFallback: Story = {
  name: "Unsupported (icon fallback)",
  args: {
    fileKind: "doc",
    fileName: "report.pdf",
    preview: { kind: "unsupported" },
  },
};

export const EmptyFallback: Story = {
  name: "Empty / loading fallback",
  args: {
    fileKind: "doc",
    fileName: "draft.md",
  },
};

export const DetailPaneScrollable: Story = {
  name: "Detail pane (scrollable text)",
  decorators: [
    (Story) => (
      <div className="drive-workspace w-80">
        <div className="drive-detail-panel__preview">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    fileKind: "doc",
    fileName: "Spec.md",
    preview: {
      kind: "text",
      content:
        "Line one of the document.\nLine two continues the preview body.\nLine three shows scrollable pane mode for detail surfaces.",
    },
    textMode: "scrollable",
  },
};

export const DetailPaneDocsEditor: Story = {
  name: "Detail pane (read-only Docs editor)",
  decorators: [
    (Story) => (
      <div className="drive-workspace w-80">
        <div className="drive-detail-panel__preview relative aspect-[4/3] overflow-hidden">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    fileKind: "doc",
    fileName: "Spec.md",
    preview: {
      kind: "docs",
      content: "# Spec\n\nRich **markdown** preview via the Docs editor.",
    },
    textMode: "scrollable",
    mediaClassName: "drive-detail-panel__preview-media",
  },
};
