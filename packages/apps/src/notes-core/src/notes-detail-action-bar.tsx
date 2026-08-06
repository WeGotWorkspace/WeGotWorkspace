import {
  Archive,
  ArchiveRestore,
  BookOpen,
  MoreHorizontal,
  Share2,
  Star,
  Users,
} from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import { Tag } from "@/tag/src/tag";
import type { Note } from "@/lib/models/note";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import { noteListLocationLabel, noteShowsStarControls } from "@/notes-core/src/notes-note-utils";
import { NoteCollabChrome } from "@/note-detail-view/src/note-text-editor-body";
import "@/notes-core/src/notes-detail-action-bar.css";

type NotesDetailActionBarProps = {
  active: Note | undefined;
  labels: NotesUILabels;
  archived: Record<string, boolean>;
  starred: Record<string, boolean>;
  closeMobileDetail: () => void;
  openMoveDialog: (ids: string[]) => void;
  toggleStar: (id: string) => void;
  toggleArchive: (id: string) => void;
  /** When true, renders collab presence ahead of note actions (requires NoteCollabSession). */
  showCollabChrome?: boolean;
  /** Opens Notes-mode ShareDialog for the active note. */
  onShare?: () => void;
  /**
   * View-only share: disable move / star (body+tags gated separately
   * via NoteDetailView `readOnly`).
   */
  readOnly?: boolean;
  /**
   * Full share / owner: archive + structure manage. Edit-only shares stay false.
   * Defaults true for Storybook / owned notes without an explicit gate.
   */
  canArchive?: boolean;
};

export function NotesDetailActionBar({
  active,
  labels,
  archived,
  starred,
  closeMobileDetail,
  openMoveDialog,
  toggleStar,
  toggleArchive,
  showCollabChrome = false,
  onShare,
  readOnly = false,
  canArchive = true,
}: NotesDetailActionBarProps) {
  if (!active) {
    return <ActionBar onBack={closeMobileDetail} />;
  }

  const sharedInbox = !!active.sharedInbox;
  const groupNotebook = !sharedInbox && active.scope === "group";
  const notebookLocked = sharedInbox || groupNotebook || readOnly;
  const showStar = noteShowsStarControls(active);
  const archiveLocked = !canArchive;
  const locationLabel =
    noteListLocationLabel(active, labels) || active.notebook.trim() || labels.toolbarMoveToNotebook;

  const notebookIcon = sharedInbox ? (
    <Tag
      label={locationLabel}
      size="md"
      icon={<Share2 aria-hidden />}
      className="notes-detail-action-bar__shared-by"
    />
  ) : groupNotebook ? (
    <Users />
  ) : (
    <BookOpen />
  );

  const rightActions = [
    ...(onShare
      ? [
          {
            id: "share",
            label: labels.share,
            onClick: onShare,
            icon: <Share2 />,
          },
        ]
      : []),
    {
      id: "move-to-notebook",
      label: locationLabel,
      tooltip: notebookLocked ? locationLabel : labels.toolbarMoveToNotebook,
      onClick: notebookLocked ? undefined : () => openMoveDialog([active.id]),
      icon: notebookIcon,
      active: true,
      // Shared-with-me: Tag chip is the icon; hide duplicate text label.
      showLabel: !sharedInbox,
      disabled: notebookLocked,
    },
    ...(showStar
      ? [
          {
            id: "toggle-star",
            label: labels.toolbarStar,
            onClick: readOnly ? undefined : () => toggleStar(active.id),
            active: !!starred[active.id],
            icon: <Star />,
            disabled: readOnly,
          },
        ]
      : []),
    {
      id: "toggle-archive",
      label: archived[active.id] ? labels.toolbarUnarchive : labels.toolbarArchive,
      onClick: archiveLocked ? undefined : () => toggleArchive(active.id),
      active: !!archived[active.id],
      icon: archived[active.id] ? <ArchiveRestore /> : <Archive />,
      disabled: archiveLocked,
    },
  ];

  return (
    <ActionBar
      onBack={closeMobileDetail}
      rightLeading={showCollabChrome ? <NoteCollabChrome /> : undefined}
      rightActions={rightActions}
      rightMenuLabel="More actions"
      rightMenuIcon={<MoreHorizontal />}
    />
  );
}
