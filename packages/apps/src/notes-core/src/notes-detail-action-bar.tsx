import { Archive, ArchiveRestore, MoreHorizontal, Star } from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import type { Note } from "@/lib/models/note";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";

type NotesDetailActionBarProps = {
  active: Note | undefined;
  labels: NotesUILabels;
  archived: Record<string, boolean>;
  starred: Record<string, boolean>;
  closeMobileDetail: () => void;
  /** List / view title shown on the mobile back control. */
  backLabel?: string;
  toggleStar: (id: string) => void;
  toggleArchive: (id: string) => void;
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
  backLabel,
  toggleStar,
  toggleArchive,
  canArchive = true,
}: NotesDetailActionBarProps) {
  // Empty / deselected detail: caller must omit this bar. Never render a
  // back-only ActionBar — that regressed as chrome when no note is selected.
  if (!active) {
    return null;
  }

  // The notebook switcher lives above the title (NotesDetailNotebookSelect).
  const archiveLocked = !canArchive;

  const rightActions = [
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
      onClick: archiveLocked ? undefined : () => toggleArchive(active.id),
      active: !!archived[active.id],
      icon: archived[active.id] ? <ArchiveRestore /> : <Archive />,
      disabled: archiveLocked,
    },
  ];

  return (
    <ActionBar
      onBack={closeMobileDetail}
      backLabel={backLabel}
      rightActions={rightActions}
      rightMenuLabel="More actions"
      rightMenuIcon={<MoreHorizontal />}
    />
  );
}
