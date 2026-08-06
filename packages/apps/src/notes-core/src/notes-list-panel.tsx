import { useRef, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { Archive, Circle, Pencil, RefreshCw, Star, Tag as TagIcon, Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { ListItem } from "@/list-item/src/list-item";
import { Tag } from "@/tag/src/tag";
import { ViewHeader } from "@/view-header/src/view-header";
import { useListReorderAnimation } from "@/hooks/use-list-reorder-animation";
import type { Note } from "@/lib/models/note";
import { formatNoteDateForList } from "@/notes-core/src/notes-date-utils";
import { noteListTagOverflow, noteListTitle } from "@/notes-core/src/notes-note-utils";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
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

type NotesListPanelProps = {
  L: NotesUILabels;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  viewLabel: string;
  selectedIds: string[];
  selectionMode: boolean;
  listLoading: boolean;
  visibleNotes: Note[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  canEditDelete: boolean;
  selectedNotebook: string | null;
  selectedTag: string | null;
  view: string;
  isTouch: boolean;
  starred: Record<string, boolean>;
  archived: Record<string, boolean>;
  activeId: string;
  isItemDragging: (id: string) => boolean;
  handleSelect: (id: string, e: ReactMouseEvent) => void;
  enterSelectionFor: (id: string) => void;
  itemDragHandlers: (id: string) => Record<string, unknown>;
  openEditDialog: (item: { kind: "notebook" | "tag"; name: string }) => void;
  openDeleteDialog: (item: { kind: "notebook" | "tag"; name: string }) => void;
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
  searchQuery,
  setSearchQuery,
  searchInputRef,
  canEditDelete,
  selectedNotebook,
  selectedTag,
  view,
  isTouch,
  starred,
  archived,
  activeId,
  isItemDragging,
  handleSelect,
  enterSelectionFor,
  itemDragHandlers,
  openEditDialog,
  openDeleteDialog,
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
            : L.listFiles(visibleNotes.length)
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
            {canEditDelete ? (
              <>
                <IconButton
                  label={L.edit}
                  onClick={() =>
                    openEditDialog(
                      selectedNotebook
                        ? { kind: "notebook", name: selectedNotebook }
                        : { kind: "tag", name: selectedTag! },
                    )
                  }
                  icon={<Pencil />}
                  size="sm"
                  variant="subtle"
                />
                <IconButton
                  label={L.remove}
                  onClick={() =>
                    openDeleteDialog(
                      selectedNotebook
                        ? { kind: "notebook", name: selectedNotebook }
                        : { kind: "tag", name: selectedTag! },
                    )
                  }
                  icon={<Trash2 />}
                  size="sm"
                  variant="subtle"
                />
              </>
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
            // Single-select UI: only the open row may look highlighted. Multi-select:
            // selected rows only (suppress active paint so a leftover activeId cannot
            // light a second beige row).
            const rowActive = !multiSelect && note.id === activeId;
            const rowSelected = multiSelect
              ? selectedIds.includes(note.id)
              : note.id === activeId && selectedIds.includes(note.id);
            return (
              <ListItem
                key={note.id}
                id={note.id}
                title={noteListTitle(note)}
                subtitle={note.notebook}
                date={formatNoteDateForList(note.date)}
                text={notesListItemTags(note.tags)}
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
                  <span
                    key="star"
                    className="notes-list-panel__star-pip"
                    data-active={starred[note.id] ? "true" : "false"}
                  >
                    <Star className="notes-list-panel__star-icon" fill="currentColor" />
                  </span>,
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
                      swipeRightAction: {
                        icon: <Archive className="size-5" />,
                        color: "var(--color-ink)",
                        label: archived[note.id] ? L.swipeUnarchive : L.swipeArchive,
                        destructive: true,
                        onActivate: () => toggleArchive(note.id),
                      },
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
