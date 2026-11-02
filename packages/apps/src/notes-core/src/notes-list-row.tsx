import { memo, type CSSProperties } from "react";
import { Archive, Circle, Eye, Share2, Star } from "lucide-react";
import { ListItem } from "@/list-item/src/list-item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import type { Note } from "@/lib/models/note";
import { formatNoteDateForList } from "@/notes-core/src/notes-date-utils";
import {
  NOTE_LIST_EMPTY_TITLE,
  noteListExcerpt,
  noteListTitle,
  noteListLocationLabel,
  noteShowsSharedBadge,
  noteShowsStarControls,
  noteShowsViewOnlyBadge,
} from "@/notes-core/src/notes-note-utils";
import { notebookDisplayColor, notebookDotColor } from "@/notes-core/src/notes-notebook-color";
import { NotesNotebookColorIcon } from "@/notes-core/src/notes-notebook-color-icon";
import { noteAllowsStructureManage } from "@/notes-core/src/notes-structure-rights";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";

function NotesListNotebookMark({
  location,
  notebookColor,
}: {
  location: string;
  notebookColor?: string | null;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="notes-list-panel__notebook"
          role="img"
          aria-label={location}
          style={
            {
              "--collection-row-color": notebookDotColor({ color: notebookColor }),
            } as CSSProperties
          }
        >
          <NotesNotebookColorIcon className="notes-list-panel__notebook-icon" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{location}</TooltipContent>
    </Tooltip>
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

const ROW_PROP_KEYS = [
  "note",
  "L",
  "notebookCollections",
  "isTouch",
  "starred",
  "archived",
  "pendingSync",
  "dragging",
  "onToggleStar",
  "onToggleArchive",
] as const satisfies readonly (keyof NotesListRowProps)[];

/**
 * Compare only the row's own props. On touch, `SwipeableList` clones each child
 * with a fresh `resetState` callback and an index-based `id` on every render;
 * `ListItem` ignores both, so they must not defeat the memo (#1714).
 */
function sameNotesListRowProps(prev: NotesListRowProps, next: NotesListRowProps): boolean {
  return ROW_PROP_KEYS.every((key) => Object.is(prev[key], next[key]));
}

/** One note in the list. Re-renders only when its own note or flags change. */
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
  const showStar = noteShowsStarControls(note);
  const showShared = noteShowsSharedBadge(note);
  const showViewOnly = noteShowsViewOnlyBadge(note);
  const canArchive = noteAllowsStructureManage(note);
  const notebookColor = notebookDisplayColor(note, notebookCollections);
  const location = noteListLocationLabel(note, L, notebookCollections);
  const excerpt = noteListExcerpt(note);
  return (
    <ListItem
      id={note.id}
      title={note.title?.trim() ? noteListTitle(note) : ""}
      emptyTitle={NOTE_LIST_EMPTY_TITLE}
      subtitle={null}
      metaPosition="below"
      date={formatNoteDateForList(note.date)}
      showEmptyText
      text={excerpt ? <span className="notes-list-panel__excerpt">{excerpt}</span> : null}
      icons={[
        location ? (
          <NotesListNotebookMark key="notebook" location={location} notebookColor={notebookColor} />
        ) : null,
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
        showStar ? (
          <span
            key="star"
            className="notes-list-panel__star-pip"
            data-active={starred ? "true" : "false"}
          >
            <Star className="size-3 notes-list-panel__star-icon" fill="currentColor" aria-hidden />
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
            ...(showStar
              ? {
                  swipeLeftAction: {
                    icon: <Star className="size-5" fill={starred ? "currentColor" : "none"} />,
                    color: "var(--color-emerald)",
                    label: starred ? L.swipeUnstar : L.swipeStar,
                    onActivate: () => onToggleStar(note.id),
                  },
                }
              : {}),
            ...(canArchive
              ? {
                  swipeRightAction: {
                    icon: <Archive className="size-5" />,
                    color: "var(--workspace-accent)",
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
}, sameNotesListRowProps);
