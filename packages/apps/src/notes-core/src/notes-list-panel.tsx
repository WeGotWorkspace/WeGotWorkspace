import {
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Archive,
  Circle,
  Eye,
  RefreshCw,
  Share2,
  Star,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { IconButton } from "@/button/src/button";
import { ListItem } from "@/list-item/src/list-item";
import { Tag } from "@/tag/src/tag";
import { ViewHeader } from "@/view-header/src/view-header";
import { useListReorderAnimation } from "@/hooks/use-list-reorder-animation";
import type { Note } from "@/lib/models/note";
import { formatNoteDateForList } from "@/notes-core/src/notes-date-utils";
import {
  noteListExcerpt,
  noteListTagOverflow,
  noteListTitle,
  noteListLocationLabel,
  noteShowsSharedBadge,
  noteShowsStarControls,
  noteShowsTags,
  noteShowsViewOnlyBadge,
} from "@/notes-core/src/notes-note-utils";
import { notebookDotColor } from "@/notes-core/src/notes-notebook-color";
import { noteAllowsStructureManage } from "@/notes-core/src/notes-structure-rights";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import "@/collection-sidebar/src/collection-sidebar-row.css";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { WorkspaceSwipeList } from "@/workspace-swipe-list/src/workspace-swipe-list";
import { cn } from "@/lib/utils";
import "@/notes-core/src/notes-list-panel.css";

function notesListItemTags(tags: string[]): ReactNode {
  const { visible, overflow } = noteListTagOverflow(tags);
  if (visible.length === 0) return null;
  return (
    <span className="list-item__tags">
      {visible.map((tag) => (
        <Tag key={tag} label={tag} size="md" icon={<TagIcon />} />
      ))}
      {overflow > 0 ? <span className="list-item__tags-more">+{overflow} more</span> : null}
    </span>
  );
}

function NotesListLocation({
  note,
  labels,
  notebookColor,
  notebookCollections,
}: {
  note: Note;
  labels: NotesUILabels;
  notebookColor?: string | null;
  notebookCollections: NotesNotebookCollection[];
}) {
  const location = noteListLocationLabel(note, labels, notebookCollections);
  if (!location) return null;
  return (
    <span className="notes-list-panel__notebook">
      <span
        className="collection-sidebar-row__dot notes-list-panel__notebook-dot"
        style={{ "--collection-row-color": notebookDotColor({ color: notebookColor }) } as CSSProperties}
        aria-hidden
      />
      <span className="notes-list-panel__notebook-name">{location}</span>
    </span>
  );
}

type NotesListPanelProps = {
  L: NotesUILabels;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  viewLabel: string;
  selectedIds: string[];
  selectionMode: boolean;
  listLoading: boolean;
  visibleNotes: Note[];
  notebookCollections?: NotesNotebookCollection[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  view: string;
  isTouch: boolean;
  starred: Record<string, boolean>;
  archived: Record<string, boolean>;
  activeId: string;
  isItemDragging: (id: string) => boolean;
  handleSelect: (id: string, e: ReactMouseEvent) => void;
  enterSelectionFor: (id: string) => void;
  itemDragHandlers: (id: string) => Record<string, unknown>;
  openDeleteConfirmForArchive: (ids: string[], mode: "selected" | "all") => void;
  toggleStar: (id: string) => void;
  toggleArchive: (id: string) => void;
  selectionBar: ReactNode;
  onRefreshList?: () => void;
  pendingNoteIds?: ReadonlySet<string>;
};

export function NotesListPanel({
  L,
  sidebarOpen,
  onToggleSidebar,
  viewLabel,
  selectedIds,
  selectionMode,
  listLoading,
  visibleNotes,
  notebookCollections = [],
  searchQuery,
  setSearchQuery,
  searchInputRef,
  view,
  isTouch,
  starred,
  archived,
  activeId,
  isItemDragging,
  handleSelect,
  enterSelectionFor,
  itemDragHandlers,
  openDeleteConfirmForArchive,
  toggleStar,
  toggleArchive,
  selectionBar,
  onRefreshList,
  pendingNoteIds,
}: NotesListPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useListReorderAnimation(
    listRef,
    visibleNotes.map((note) => note.id),
  );

  return {
    header: (
      <ViewHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        title={viewLabel}
        subtitle={
          selectionMode || selectedIds.length > 1
            ? L.listSelected(selectedIds.length)
            : L.listItems(visibleNotes.length)
        }
        actions={
          <div className="notes-list-panel__header-actions flex items-center gap-2">
            {onRefreshList ? (
              <IconButton
                label={L.refreshList}
                onClick={onRefreshList}
                disabled={listLoading}
                icon={
                  <RefreshCw className={cn("size-4", listLoading && "animate-spin")} aria-hidden />
                }
                size="sm"
                variant="subtle"
              />
            ) : null}
            {view === "archive" && visibleNotes.length > 0 ? (
              <IconButton
                label={L.emptyArchive}
                onClick={() =>
                  openDeleteConfirmForArchive(
                    visibleNotes.map((n) => n.id),
                    "all",
                  )
                }
                icon={<Trash2 />}
                size="sm"
                variant="subtle"
              />
            ) : null}
          </div>
        }
        searchPlaceholder={L.searchPlaceholder}
        searchValue={searchQuery}
        onSearchInput={setSearchQuery}
        searchInputRef={searchInputRef}
      />
    ),
    listContent: listLoading ? (
      <div className="notes-list-panel__loading" aria-busy>
        <LoadingSpinner size="lg" label={L.listLoading} />
      </div>
    ) : (
      <div ref={listRef} className="notes-list-panel__list">
        <WorkspaceSwipeList isTouch={isTouch}>
          {visibleNotes.map((note) => {
            const dragHandlers = itemDragHandlers(note.id) as {
              onDragStart?: () => void;
              onDragEnd?: () => void;
            };
            const isPendingSync = pendingNoteIds?.has(note.id) ?? false;
            const multiSelect = selectionMode || selectedIds.length > 1;
            // Single-select UI: open row = activeId ∩ selectedIds (stale activeId
            // after empty selection must not paint). Multi-select: selected rows
            // only (suppress active paint so leftover activeId cannot light a
            // second beige row).
            const rowActive = !multiSelect && note.id === activeId && selectedIds.includes(note.id);
            const rowSelected = multiSelect
              ? selectedIds.includes(note.id)
              : note.id === activeId && selectedIds.includes(note.id);
            const showTags = noteShowsTags(note);
            const showStar = noteShowsStarControls(note);
            const showShared = noteShowsSharedBadge(note);
            const showViewOnly = noteShowsViewOnlyBadge(note);
            const canArchive = noteAllowsStructureManage(note);
            const notebook = notebookCollections.find(
              (item) => item.id === note.notebookId || item.name === note.notebook,
            );
            const excerpt = noteListExcerpt(note);
            const tagsRow = showTags ? notesListItemTags(note.tags) : null;
            return (
              <ListItem
                key={note.id}
                id={note.id}
                title={noteListTitle(note)}
                subtitle={
                  <NotesListLocation
                    note={note}
                    labels={L}
                    notebookColor={notebook?.color}
                    notebookCollections={notebookCollections}
                  />
                }
                date={formatNoteDateForList(note.date)}
                text={
                  excerpt || tagsRow ? (
                    <>
                      {excerpt ? <span className="notes-list-panel__excerpt">{excerpt}</span> : null}
                      {tagsRow}
                    </>
                  ) : null
                }
                icons={[
                  isPendingSync ? (
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
                      data-active={starred[note.id] ? "true" : "false"}
                    >
                      <Star
                        className="size-3 notes-list-panel__star-icon"
                        fill="currentColor"
                        aria-hidden
                      />
                    </span>
                  ) : null,
                ].filter(Boolean)}
                isActive={rowActive}
                isSelected={rowSelected}
                selectionMode={selectionMode}
                isTouch={isTouch}
                isDragging={isItemDragging(note.id)}
                onClick={(e: ReactMouseEvent) => handleSelect(note.id, e)}
                onLongPress={() => enterSelectionFor(note.id)}
                {...dragHandlers}
                onDragStart={dragHandlers.onDragStart ?? (() => {})}
                onDragEnd={dragHandlers.onDragEnd ?? (() => {})}
                {...(isTouch
                  ? {
                      ...(showStar
                        ? {
                            swipeLeftAction: {
                              icon: (
                                <Star
                                  className="size-5"
                                  fill={starred[note.id] ? "currentColor" : "none"}
                                />
                              ),
                              color: "var(--color-emerald)",
                              label: starred[note.id] ? L.swipeUnstar : L.swipeStar,
                              onActivate: () => toggleStar(note.id),
                            },
                          }
                        : {}),
                      ...(canArchive
                        ? {
                            swipeRightAction: {
                              icon: <Archive className="size-5" />,
                              color: "var(--color-ink)",
                              label: archived[note.id] ? L.swipeUnarchive : L.swipeArchive,
                              destructive: true,
                              onActivate: () => toggleArchive(note.id),
                            },
                          }
                        : {}),
                    }
                  : {})}
              />
            );
          })}
        </WorkspaceSwipeList>
      </div>
    ),
    hasItems: listLoading || visibleNotes.length > 0,
    emptyLabel: L.emptyList,
    floatingActionBar: selectionBar,
  };
}
