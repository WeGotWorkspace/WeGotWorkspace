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
import type { Note } from "@/lib/models/note";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import { noteListLocationLabel, noteShowsStarControls } from "@/notes-core/src/notes-note-utils";
import { NoteCollabChrome } from "@/note-detail-view/src/note-text-editor-body";

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
   * View-only share: disable move / star / archive (body+tags gated separately
   * via NoteDetailView `readOnly`).
   */
  readOnly?: boolean;
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
}: NotesDetailActionBarProps) {
  if (!active) {
    return <ActionBar onBack={closeMobileDetail} />;
  }

  const sharedInbox = !!active.sharedInbox;
  const groupNotebook = !sharedInbox && active.scope === "group";
  const notebookLocked = sharedInbox || groupNotebook || readOnly;
  const showStar = noteShowsStarControls(active);
  const locationLabel =
    noteListLocationLabel(active, labels) || active.notebook.trim() || labels.toolbarMoveToNotebook;

  const notebookIcon = sharedInbox ? <Share2 /> : groupNotebook ? <Users /> : <BookOpen />;

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
      showLabel: true,
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
      onClick: readOnly ? undefined : () => toggleArchive(active.id),
      active: !!archived[active.id],
      icon: archived[active.id] ? <ArchiveRestore /> : <Archive />,
      disabled: readOnly,
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
