import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MailDetailView } from "@/mail-core/src/mail-detail-view";
import { mailStoryLabels } from "@/mail-core/src/mail-app.stories.fixtures";
import { MOCK_MAIL_DETAIL_HTML_BODY } from "@/lib/api/mock/mail-seed";
import { MailStoryScope } from "./mail-story-scope";

const L = mailStoryLabels;

const meta = {
  title: "Shared/Mail/Panes/Detail",
  component: MailDetailView,
  render: (args) => (
    <MailStoryScope variant="detail">
      <MailDetailView {...args} />
    </MailStoryScope>
  ),
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof MailDetailView>;

export default meta;
type Story = StoryObj<typeof MailDetailView>;

const baseArgs = {
  mailId: "m-demo",
  mailbox: "Inbox",
  date: "10:42",
  title: "Revised proofs for the autumn issue",
  emptySubjectLabel: L.noSubject,
  from: "Hana Ito",
  senderMetaLine: `hana@studio-meridian.jp${L.detailToViewer("me")}`,
  detailLoaded: true,
} as const;

export const PlainBody: Story = {
  tags: ["vitest-ci"],
  args: {
    ...baseArgs,
    body: [
      "I've attached the second pass — the type sits better now, and we tightened the gutter on the spreads you flagged.",
      "Let me know if the new heading weight reads warmer to you.",
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Revised proofs for the autumn issue" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/type sits better now/i)).toBeInTheDocument();
  },
};

export const HtmlBody: Story = {
  args: {
    ...baseArgs,
    body: [],
    bodyHtml: MOCK_MAIL_DETAIL_HTML_BODY,
  },
};

export const NoSubject: Story = {
  args: {
    ...PlainBody.args,
    title: "",
  },
};

export const WithAttachments: Story = {
  args: {
    ...HtmlBody.args,
    attachments: [
      { id: "a-1", name: "autumn-proof-v2.pdf", type: "application/pdf", size: 1_844_640 },
      { id: "a-2", name: "cover-options.zip", type: "application/zip", size: 8_612_944 },
    ],
  },
};
