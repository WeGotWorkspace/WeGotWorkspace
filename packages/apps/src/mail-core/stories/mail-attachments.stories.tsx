import type { Meta, StoryObj } from "@storybook/react-vite";
import { MailAttachments } from "../src/mail-attachments";
import { MailStoryScope } from "./mail-story-scope";

const meta: Meta<typeof MailAttachments> = {
  title: "Features/Mail/Panes/Attachments",
  component: MailAttachments,
  render: (args) => (
    <MailStoryScope variant="pane">
      <MailAttachments {...args} />
    </MailStoryScope>
  ),
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof MailAttachments>;

const attachments = [
  { id: "a-1", name: "contract-v4.pdf", type: "application/pdf", size: 2_145_391 },
  { id: "a-2", name: "hero-image.png", type: "image/png", size: 918_442 },
  { id: "a-3", name: "research-notes.md", type: "text/markdown", size: 18_111 },
];

export const DownloadHandlerMode: Story = {
  args: {
    attachments,
    onDownload: () => {},
  },
};

export const DirectUrlMode: Story = {
  args: {
    attachments,
    buildDownloadUrl: (attachment) => `#download-${attachment.id ?? attachment.name}`,
  },
};
