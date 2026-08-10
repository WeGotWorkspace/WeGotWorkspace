import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMailAppBootstrap } from "@/lib/api/mock/mail-bootstrap";
import { MailDetailActionBar } from "@/mail-core/src/mail-detail-action-bar";
import { useStarredMap } from "@/hooks/use-starred-map";
import { MailStoryScope } from "./mail-story-scope";

function MailDetailActionBarHarness({
  preset = "inbox",
}: {
  preset?: "inbox" | "draft" | "starred" | "trash";
}) {
  const data = useMemo(() => createMailAppBootstrap().data, []);
  const active = useMemo(() => {
    if (preset === "draft") return data.mail.find((row) => row.mailbox === "Drafts");
    if (preset === "trash") {
      return {
        ...data.mail[0]!,
        id: "m-trash",
        mailbox: "Trash",
        folder: "Trash",
        unread: false,
      };
    }
    return data.mail[0];
  }, [data.mail, preset]);

  const { starred, toggleStar, setStarred } = useStarredMap({});
  const [unread, setUnread] = useState(true);

  useEffect(() => {
    if (!active?.id) return;
    setStarred({ [active.id]: preset === "starred" });
    setUnread(active.unread);
  }, [active?.id, active?.unread, preset, setStarred]);

  if (!active) {
    return (
      <p className="text-sm text-[color-mix(in_oklab,var(--color-ink)_55%,transparent)]">
        No messages in bootstrap seed for this story.
      </p>
    );
  }

  const message = { ...active, unread };

  return (
    <MailStoryScope variant="detail">
      <div className="mail-story-scope__action-bar-shell sticky top-0 z-10 border-b px-2 py-2">
        <MailDetailActionBar
          active={message}
          closeMobileDetail={() => {}}
          backLabel="Inbox"
          onReply={() => {}}
          onReplyAll={() => {}}
          onForward={() => {}}
          onEditDraft={() => {}}
          setMoveDialog={() => {}}
          markRead={() => setUnread(false)}
          markUnread={() => setUnread(true)}
          toggleStar={toggleStar}
          starred={starred}
          toggleArchiveForMessage={() => {}}
          toggleTrashForMessage={() => {}}
        />
      </div>
    </MailStoryScope>
  );
}

const meta = {
  title: "Apps/Mail/Panes/Detail action bar",
  component: MailDetailActionBarHarness,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    preset: {
      control: "select",
      options: ["inbox", "draft", "starred", "trash"],
    },
  },
} satisfies Meta<typeof MailDetailActionBarHarness>;

export default meta;
type Story = StoryObj<typeof MailDetailActionBarHarness>;

export const Inbox: Story = {
  args: { preset: "inbox" },
};

export const Draft: Story = {
  args: { preset: "draft" },
};

export const Starred: Story = {
  args: { preset: "starred" },
};

export const Trash: Story = {
  args: { preset: "trash" },
};
