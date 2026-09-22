import type { Meta, StoryObj } from "@storybook/react-vite";
import { TooltipProvider } from "@/ui/tooltip";
import { MailAttachmentChip } from "@/mail-core/src/mail-attachment-chip";
import { MailStoryScope } from "./mail-story-scope";

const meta: Meta<typeof MailAttachmentChip> = {
  title: "Shared/Mail/Components/AttachmentChip",
  component: MailAttachmentChip,
  render: (args) => (
    <TooltipProvider delayDuration={150}>
      <MailStoryScope variant="pane">
        <div className="flex flex-wrap gap-2">
          <MailAttachmentChip {...args} />
        </div>
      </MailStoryScope>
    </TooltipProvider>
  ),
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof MailAttachmentChip>;

export const DownloadHandler: Story = {
  args: {
    name: "contract-v4.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2_145_391,
    onDownload: () => {},
  },
};

export const DirectUrl: Story = {
  args: {
    name: "hero-image.png",
    mimeType: "image/png",
    sizeBytes: 918_442,
    downloadHref: "#download-hero-image",
  },
};

export const Removable: Story = {
  args: {
    name: "draft-notes.md",
    mimeType: "text/markdown",
    sizeBytes: 18_111,
    onRemove: () => {},
  },
};
