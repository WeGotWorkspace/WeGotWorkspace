import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { MailComposeView } from "@/mail-core/src/mail-compose-view";
import { mailStoryLabels } from "@/mail-core/src/mail-app.stories.fixtures";
import { createComposeAttachment } from "@/mail-core/src/mail-compose-utils";
import type { MailComposeAttachment } from "@/mail-core/src/mail-compose-utils";
import { MailStoryScope } from "./mail-story-scope";

const L = mailStoryLabels;

function MailComposeViewHarness({ mode = "new" as const }: { mode?: "new" | "reply" | "draft" }) {
  const [to, setTo] = useState(mode === "draft" ? "" : "ada@northlight.design");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(
    mode === "reply" ? "Re: Studio visit next month" : mode === "draft" ? "(no subject)" : "",
  );
  const [body, setBody] = useState(
    mode === "reply"
      ? "Thanks — Thursday afternoon works for me.\n\n> We'll be in town the week of the 21st."
      : "A few thoughts on the binding…",
  );
  const [attachments, setAttachments] = useState<MailComposeAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  return (
    <MailStoryScope variant="compose-dialog">
      <MailComposeView
        composeMode={mode}
        mailbox="Drafts"
        to={to}
        cc={cc}
        bcc={bcc}
        subject={subject}
        body={body}
        attachments={attachments}
        onToChange={setTo}
        onCcChange={setCc}
        onBccChange={setBcc}
        onSubjectChange={setSubject}
        onBodyChange={setBody}
        onAddAttachments={(files) =>
          setAttachments((prev) => [...prev, ...files.map((file) => createComposeAttachment(file))])
        }
        onRemoveAttachment={(id) =>
          setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
        }
        attachFilesLabel={L.composeAttachFiles}
        attachmentsLabel={L.composeAttachmentsLabel}
        removeAttachmentLabel={L.composeRemoveAttachment}
        deleteDraftLabel={L.composeDeleteDraft}
        onSaveDraft={() => {
          setSaving(true);
          window.setTimeout(() => setSaving(false), 600);
        }}
        onSend={() => {
          setSending(true);
          window.setTimeout(() => setSending(false), 600);
        }}
        onDiscard={() => {}}
        saving={saving}
        sending={sending}
      />
    </MailStoryScope>
  );
}

const meta = {
  title: "Features/Mail/Panes/Compose",
  component: MailComposeViewHarness,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    mode: {
      control: "select",
      options: ["new", "reply", "draft"],
    },
  },
} satisfies Meta<typeof MailComposeViewHarness>;

export default meta;
type Story = StoryObj<typeof MailComposeViewHarness>;

export const NewMessage: Story = {
  tags: ["vitest-ci"],
  args: { mode: "new" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const subject = canvas.getByPlaceholderText("Subject");
    await userEvent.click(subject);
    await userEvent.type(subject, "Quarterly update");
    await waitFor(() => {
      expect(subject).toHaveValue("Quarterly update");
    });
    await userEvent.click(canvas.getByRole("button", { name: "(B)cc" }));
    await expect(canvas.queryByRole("button", { name: "(B)cc" })).not.toBeInTheDocument();
    await expect(canvas.getAllByPlaceholderText("Optional").length).toBeGreaterThanOrEqual(1);
  },
};

export const Reply: Story = {
  args: { mode: "reply" },
};

export const EditDraft: Story = {
  args: { mode: "draft" },
};
