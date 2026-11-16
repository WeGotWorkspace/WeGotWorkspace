import { memo } from "react";
import { Archive, Circle, Eye, Share2, Star } from "lucide-react";
import { ListItem } from "@/list-item/src/list-item";
import type { Note } from "@/lib/models/note";
import { formatNoteDateForList } from "@/notes-core/src/notes-date-utils";
import {
  NOTE_LIST_EMPTY_TITLE,
  noteListExcerpt,
  noteListTitle,
  noteListLocationLabel,
  noteShowsSharedBadge,
  noteShowsViewOnlyBadge,
} from "@/notes-core/src/notes-note-utils";
import { notebookDisplayColor, notebookDotColor } from "@/lib/models/notebook-color";
import { CollectionColorDot } from "@/ui/collection-color-dot";
import { noteAllowsStructureManage } from "@/notes-core/src/notes-structure-rights";
import type { NotesNotebookCollection } from "@/lib/models/notes-types";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import { workspaceListRowPropsEqual } from "@/workspace-list/src/workspace-list-row-props";

/** The notebook at the foot of a row: its colour dot and its name. */
function NotesListNotebook({ name, color }: { name: string; color?: string }) {
  return (
    <span className="notes-list-panel__notebook">
      <CollectionColorDot color={notebookDotColor({ color })} />
      <span className="notes-list-panel__notebook-name">{name}</span>
    </span>
  );
}

export type NotesListRowProps = {
  note: Note;
  L: NotesUILabels;
  notebookCollections: NotesNotebookCollection[];
  isTouch: boolean;
  starred: boolean;
  archived: boolean;
  pendingSync: boolean;
  dragging: boolean;
  /** Must keep its identity across renders, or every row re-renders. */
  onToggleStar: (id: string) => void;
  /** Must keep its identity across renders, or every row re-renders. */
  onToggleArchive: (id: string) => void;
};

/**
 * One note in the list. Re-renders only when its own note or flags change; the
 * shared comparison ignores the props `SwipeableList` injects on touch (#1714).
 */
export const NotesListRow = memo(function NotesListRow({
  note,
  L,
  notebookCollections,
  isTouch,
  starred,
  archived,
  pendingSync,
  dragging,
  onToggleStar,
  onToggleArchive,
}: NotesListRowProps) {
  const showShared = noteShowsSharedBadge(note);
  const showViewOnly = noteShowsViewOnlyBadge(note);
  const canArchive = noteAllowsStructureManage(note);
  const location = noteListLocationLabel(note, L, notebookCollections);
  const notebookColor = notebookDisplayColor(note, notebookCollections);
  const excerpt = noteListExcerpt(note);
  return (
    <ListItem
      id={note.id}
      title={note.title?.trim() ? noteListTitle(note) : ""}
      emptyTitle={NOTE_LIST_EMPTY_TITLE}
      /* Suite list norm: title + date top right, a two-line preview, then the notebook. */
      subtitle={location ? <NotesListNotebook name={location} color={notebookColor} /> : null}
      metaPosition="below"
      date={formatNoteDateForList(note.date)}
      dateLeading={
        starred ? (
          <span className="notes-list-panel__star-pip" role="img" aria-label={L.sidebarStarred}>
            <Star className="size-3 notes-list-panel__star-icon" fill="currentColor" aria-hidden />
          </span>
        ) : null
      }
      text={excerpt || null}
      icons={[
        pendingSync ? (
          <span
            key="pending"
            className="notes-list-panel__pending-dot"
            role="img"
            aria-label={L.pendingSync}
          >
            <Circle className="size-2.5" fill="currentColor" strokeWidth={0} />
          </span>
        ) : null,
        showViewOnly ? (
          <span
            key="view-only"
            className="notes-list-panel__view-only-pip"
            role="img"
            aria-label={L.viewOnly}
          >
            <Eye className="size-3 notes-list-panel__view-only-icon" aria-hidden />
          </span>
        ) : null,
        showShared ? (
          <span
            key="shared"
            className="notes-list-panel__shared-pip"
            role="img"
            aria-label={L.shared}
          >
            <Share2 className="size-3 notes-list-panel__shared-icon" aria-hidden />
          </span>
        ) : null,
      ].filter(Boolean)}
      isActive={false}
      isSelected={false}
      selectionMode={false}
      isTouch={isTouch}
      isDragging={dragging}
      {...(isTouch
        ? {
            swipeLeftAction: {
              icon: <Star className="size-5" fill={starred ? "currentColor" : "none"} />,
              label: starred ? L.swipeUnstar : L.swipeStar,
              onActivate: () => onToggleStar(note.id),
            },
            ...(canArchive
              ? {
                  swipeRightAction: {
                    icon: <Archive className="size-5" />,
                    label: archived ? L.swipeUnarchive : L.swipeArchive,
                    destructive: true,
                    onActivate: () => onToggleArchive(note.id),
                  },
                }
              : {}),
          }
        : {})}
    />
  );
}, workspaceListRowPropsEqual);
