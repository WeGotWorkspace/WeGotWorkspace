import { FileEdit, Forward, MoreHorizontal, Reply, ReplyAll } from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import type { Mail } from "@/types/mail";
import { buildMailActionButtons } from "@/mail-core/src/mail-action-buttons";

type MailDetailActionBarProps = {
  active: Mail | undefined;
  closeMobileDetail: () => void;
  /** List / mailbox title shown on the mobile back control. */
  backLabel?: string;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onEditDraft: () => void;
  setMoveDialog: (value: { ids: string[]; currentMailbox?: string } | null) => void;
  markRead: (ids: string[]) => void;
  markUnread: (ids: string[]) => void;
  toggleStar: (id: string) => void;
  starred: Record<string, boolean>;
  toggleArchiveForMessage: (id: string) => void;
  toggleTrashForMessage: (id: string) => void;
};

export function MailDetailActionBar({
  active,
  closeMobileDetail,
  backLabel,
  onReply,
  onReplyAll,
  onForward,
  onEditDraft,
  setMoveDialog,
  markRead,
  markUnread,
  toggleStar,
  starred,
  toggleArchiveForMessage,
  toggleTrashForMessage,
}: MailDetailActionBarProps) {
  if (!active) return <ActionBar onBack={closeMobileDetail} backLabel={backLabel} />;
  const isDraft = active.mailbox === "Drafts";
  const moveToMailbox = () => setMoveDialog({ ids: [active.id], currentMailbox: active.mailbox });
  const toggleUnreadForActive = () =>
    active.unread ? markRead([active.id]) : markUnread([active.id]);
  const toggleStarForActive = () => toggleStar(active.id);
  const toggleArchiveForActive = () => toggleArchiveForMessage(active.id);
  const toggleTrashForActive = () => toggleTrashForMessage(active.id);
  const leftActions = isDraft
    ? [{ id: "edit-draft", label: "Edit draft", icon: <FileEdit />, onClick: onEditDraft }]
    : [
        { id: "reply", label: "Reply", icon: <Reply />, onClick: onReply },
        {
          id: "reply-all",
          label: "Reply all",
          icon: <ReplyAll />,
          onClick: onReplyAll,
        },
        { id: "forward", label: "Forward", icon: <Forward />, onClick: onForward },
      ];

  const detailActionButtons = buildMailActionButtons({
    moveToMailbox,
    toggleUnread: toggleUnreadForActive,
    toggleStar: toggleStarForActive,
    toggleArchive: toggleArchiveForActive,
    toggleTrash: toggleTrashForActive,
    isUnread: active.unread,
    isStarred: !!starred[active.id],
    isArchived: active.mailbox === "Archive",
    isTrashed: active.mailbox === "Trash",
  });
  return (
    <ActionBar
      onBack={closeMobileDetail}
      backLabel={backLabel}
      leftActions={leftActions}
      leftMenuLabel="Reply options"
      leftMenuIcon={<Reply />}
      rightActions={detailActionButtons}
      rightMenuLabel="More actions"
      rightMenuIcon={<MoreHorizontal />}
    />
  );
}
