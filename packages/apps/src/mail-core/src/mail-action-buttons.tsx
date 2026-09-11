import type { ReactNode } from "react";
import { Archive, ArchiveRestore, Circle, FolderInput, Star, Trash2 } from "lucide-react";
import type { ButtonSeverity } from "@/button/src/button.shared";

export type MailActionButtonDescriptor = {
  id: "move-to-mailbox" | "mark-read-unread" | "toggle-star" | "toggle-archive" | "toggle-trash";
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  severity?: ButtonSeverity;
};

type MailActionButtonLabels = Partial<{
  moveToMailbox: string;
  markRead: string;
  markUnread: string;
  star: string;
  unstar: string;
  archive: string;
  unarchive: string;
  trash: string;
  restoreFromTrash: string;
}>;

type BuildMailActionButtonsArgs = {
  moveToMailbox: () => void;
  toggleUnread: () => void;
  toggleStar: () => void;
  toggleArchive: () => void;
  toggleTrash: () => void;
  isUnread: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  labels?: MailActionButtonLabels;
};

export function buildMailActionButtons({
  moveToMailbox,
  toggleUnread,
  toggleStar,
  toggleArchive,
  toggleTrash,
  isUnread,
  isStarred,
  isArchived,
  isTrashed,
  labels,
}: BuildMailActionButtonsArgs): MailActionButtonDescriptor[] {
  return [
    {
      id: "move-to-mailbox",
      label: labels?.moveToMailbox ?? "Move to mailbox",
      icon: <FolderInput className="size-4" />,
      onClick: moveToMailbox,
    },
    {
      id: "mark-read-unread",
      label: isUnread
        ? (labels?.markRead ?? "Mark as read")
        : (labels?.markUnread ?? "Mark as unread"),
      icon: (
        <Circle
          className={`size-4 ${isUnread ? "mail-state-accent" : ""}`}
          fill={isUnread ? "currentColor" : "none"}
          strokeWidth={isUnread ? 0 : 1.75}
        />
      ),
      onClick: toggleUnread,
      active: isUnread,
    },
    {
      id: "toggle-star",
      label: isStarred ? (labels?.unstar ?? "Unstar") : (labels?.star ?? "Star"),
      icon: <Star className="size-4" fill={isStarred ? "currentColor" : "none"} />,
      onClick: toggleStar,
      active: isStarred,
    },
    {
      id: "toggle-archive",
      label: isArchived ? (labels?.unarchive ?? "Unarchive") : (labels?.archive ?? "Archive"),
      icon: isArchived ? (
        <ArchiveRestore className="size-4 mail-state-accent" />
      ) : (
        <Archive className="size-4" />
      ),
      onClick: toggleArchive,
      active: isArchived,
      severity: isArchived ? undefined : "danger",
    },
    {
      id: "toggle-trash",
      label: isTrashed
        ? (labels?.restoreFromTrash ?? "Restore from trash")
        : (labels?.trash ?? "Trash"),
      icon: <Trash2 className={`size-4 ${isTrashed ? "mail-state-accent" : ""}`} />,
      onClick: toggleTrash,
      active: isTrashed,
      severity: isTrashed ? undefined : "danger",
    },
  ];
}
