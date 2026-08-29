import { Archive, ArchiveRestore, MoreHorizontal, Star } from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import type { Note } from "@/lib/models/note";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import {
  NotesNotebookSelect,
  type NotesNotebookSelectItem,
} from "@/notes-core/src/notes-notebook-select";
import { noteListLocationLabel, noteShowsStarControls } from "@/notes-core/src/notes-note-utils";
import { NoteCollabChrome } from "@/note-detail-view/src/note-text-editor-body";

type NotesDetailActionBarProps = {
  active: Note | undefined;
  labels: NotesUILabels;
  archived: Record<string, boolean>;
  starred: Record<string, boolean>;
  closeMobileDetail: () => void;
  /** List / view title shown on the mobile back control. */
  backLabel?: string;
  notebooks: NotesNotebookSelectItem[];
  onMoveToNotebook: (notebook: NotesNotebookSelectItem) => void;
  onCreateNotebook?: () => void;
  toggleStar: (id: string) => void;
  toggleArchive: (id: string) => void;
  /** When true, renders collab presence ahead of note actions (requires NoteCollabSession). */
  showCollabChrome?: boolean;
  /** Notebook `calendarcolor` for the switcher (same mark as CollectionSidebarRow). */
  notebookColor?: string | null;
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
  backLabel,
  notebooks,
  onMoveToNotebook,
  onCreateNotebook,
  toggleStar,
  toggleArchive,
  showCollabChrome = false,
  notebookColor,
  readOnly = false,
  canArchive = true,
}: NotesDetailActionBarProps) {
  // Empty / deselected detail: caller must omit this bar. Never render a
  // back-only ActionBar — that regressed as chrome when no note is selected.
  if (!active) {
    return null;
  }

  const sharedInbox = !!active.sharedInbox;
  const groupNotebook = !sharedInbox && active.scope === "group";
  const notebookLocked = sharedInbox || groupNotebook || readOnly;
  const showStar = noteShowsStarControls(active);
  const archiveLocked = !canArchive;
  // Personal shares: keep grantor username on the list row only — detail switcher
  // shows notebook / Shared with me, not the username chip.
  const locationLabel = sharedInbox
    ? active.notebook.trim() || labels.sidebarSharedWithMe
    : noteListLocationLabel(active, labels) ||
      active.notebook.trim() ||
      labels.toolbarMoveToNotebook;

  const rightActions = [
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
      backLabel={backLabel}
      rightLeading={
        <>
          {showCollabChrome ? <NoteCollabChrome /> : null}
          <NotesNotebookSelect
            notebooks={notebooks}
            value={{
              id: active.notebookId,
              name: locationLabel,
              color: notebookColor,
            }}
            labels={labels}
            ariaLabel={notebookLocked ? locationLabel : labels.toolbarMoveToNotebook}
            disabled={notebookLocked}
            onNotebookChange={onMoveToNotebook}
            onCreateNotebook={notebookLocked ? undefined : onCreateNotebook}
          />
        </>
      }
      rightActions={rightActions}
      rightMenuLabel="More actions"
      rightMenuIcon={<MoreHorizontal />}
    />
  );
}
