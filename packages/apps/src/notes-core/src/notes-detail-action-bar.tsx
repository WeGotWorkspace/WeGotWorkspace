import { Archive, ArchiveRestore, BookOpen, MoreHorizontal, Star } from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import type { Note } from "@/lib/models/note";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
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
}: NotesDetailActionBarProps) {
  if (!active) {
    return <ActionBar onBack={closeMobileDetail} />;
  }

  const notebookName = active.notebook.trim();
  const rightActions = [
    {
      id: "move-to-notebook",
      label: notebookName || labels.toolbarMoveToNotebook,
      tooltip: labels.toolbarMoveToNotebook,
      onClick: () => openMoveDialog([active.id]),
      icon: <BookOpen />,
      active: true,
      showLabel: true,
    },
    {
      id: "toggle-star",
      label: labels.toolbarStar,
      onClick: () => toggleStar(active.id),
      active: !!starred[active.id],
      icon: <Star />,
    },
    {
      id: "toggle-archive",
      label: archived[active.id] ? labels.toolbarUnarchive : labels.toolbarArchive,
      onClick: () => toggleArchive(active.id),
      active: !!archived[active.id],
      icon: archived[active.id] ? <ArchiveRestore /> : <Archive />,
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
