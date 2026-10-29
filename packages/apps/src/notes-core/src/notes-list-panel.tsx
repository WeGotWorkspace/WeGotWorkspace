import {
  useCallback,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { ViewHeader } from "@/view-header/src/view-header";
import { useListReorderAnimation } from "@/hooks/use-list-reorder-animation";
import type { Note } from "@/lib/models/note";
import { NotesListRow } from "@/notes-core/src/notes-list-row";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { RefreshSpinIcon } from "@/refresh-spin/src/refresh-spin-icon";
import { bindItemDragHandlers } from "@/list-item/src/use-delegated-list-item-events";
import { WorkspaceSwipeList } from "@/workspace-swipe-list/src/workspace-swipe-list";
import "@/notes-core/src/notes-list-panel.css";

/** Shared default so rows keep a stable `notebookCollections` prop. */
const NO_COLLECTIONS: NotesNotebookCollection[] = [];

type NotesListPanelProps = {
  L: NotesUILabels;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  viewLabel: string;
  selectedIds: string[];
  selectionMode: boolean;
  listLoading: boolean;
  listRefreshing?: boolean;
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
  listRefreshing = false,
  visibleNotes,
  notebookCollections = NO_COLLECTIONS,
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

  const headerCount =
    selectionMode || selectedIds.length > 1 ? selectedIds.length : visibleNotes.length;
  const headerCountLabel =
    selectionMode || selectedIds.length > 1
      ? L.listSelected(headerCount)
      : L.listItems(headerCount);

  return {
    header: (
      <ViewHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        title={viewLabel}
        titleSuffix={
          <span className="view-header__title-count" aria-label={headerCountLabel}>
            ({headerCount})
          </span>
        }
        actions={
          <div className="notes-list-panel__header-actions flex items-center gap-2">
            {onRefreshList ? (
              <IconButton
                label={L.refreshList}
                onClick={onRefreshList}
                disabled={listLoading || listRefreshing}
                icon={<RefreshSpinIcon spinning={listRefreshing} className="size-4" />}
                size="md"
                variant="outline"
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
                size="md"
                variant="outline"
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
        <NotesListRows
          L={L}
          visibleNotes={visibleNotes}
          notebookCollections={notebookCollections}
          isTouch={isTouch}
          starred={starred}
          archived={archived}
          activeId={activeId}
          selectedIds={selectedIds}
          selectionMode={selectionMode}
          isItemDragging={isItemDragging}
          handleSelect={handleSelect}
          enterSelectionFor={enterSelectionFor}
          itemDragHandlers={itemDragHandlers}
          toggleStar={toggleStar}
          toggleArchive={toggleArchive}
          pendingNoteIds={pendingNoteIds}
        />
      </div>
    ),
    hasItems: listLoading || visibleNotes.length > 0,
    emptyLabel: L.emptyList,
    floatingActionBar: selectionBar,
  };
}

function NotesListRows({
  L,
  visibleNotes,
  notebookCollections,
  isTouch,
  starred,
  archived,
  activeId,
  selectedIds,
  selectionMode,
  isItemDragging,
  handleSelect,
  enterSelectionFor,
  itemDragHandlers,
  toggleStar,
  toggleArchive,
  pendingNoteIds,
}: Pick<
  NotesListPanelProps,
  | "L"
  | "visibleNotes"
  | "notebookCollections"
  | "isTouch"
  | "starred"
  | "archived"
  | "activeId"
  | "selectedIds"
  | "selectionMode"
  | "isItemDragging"
  | "handleSelect"
  | "enterSelectionFor"
  | "itemDragHandlers"
  | "toggleStar"
  | "toggleArchive"
  | "pendingNoteIds"
>) {
  const multiSelect = selectionMode || selectedIds.length > 1;
  // Selected ids go through the shared list store immediately. Active paint
  // stays blank unless this is the single open selection, so a leftover
  // activeId cannot highlight a second row.
  const paintActiveId = !multiSelect && selectedIds.includes(activeId) ? activeId : "";

  // Rows are memoized per note (#1714). Hand them handlers that keep their
  // identity, so a new toggle callback from the controller does not re-render
  // every row.
  const handlersRef = useRef({ toggleStar, toggleArchive });
  handlersRef.current = { toggleStar, toggleArchive };
  const onToggleStar = useCallback((id: string) => handlersRef.current.toggleStar(id), []);
  const onToggleArchive = useCallback((id: string) => handlersRef.current.toggleArchive(id), []);
  const collections = notebookCollections ?? NO_COLLECTIONS;

  const rows = useMemo(
    () =>
      visibleNotes.map((note) => (
        <NotesListRow
          key={note.id}
          note={note}
          L={L}
          notebookCollections={collections}
          isTouch={isTouch}
          starred={!!starred[note.id]}
          archived={!!archived[note.id]}
          pendingSync={pendingNoteIds?.has(note.id) ?? false}
          dragging={isItemDragging(note.id)}
          onToggleStar={onToggleStar}
          onToggleArchive={onToggleArchive}
        />
      )),
    [
      L,
      archived,
      collections,
      isItemDragging,
      isTouch,
      onToggleArchive,
      onToggleStar,
      pendingNoteIds,
      starred,
      visibleNotes,
    ],
  );

  return (
    <WorkspaceSwipeList
      isTouch={isTouch}
      activeId={paintActiveId}
      selectedIds={selectedIds}
      selectionMode={multiSelect}
      onItemClick={handleSelect}
      onItemLongPress={enterSelectionFor}
      {...bindItemDragHandlers(itemDragHandlers)}
    >
      {rows}
    </WorkspaceSwipeList>
  );
}
