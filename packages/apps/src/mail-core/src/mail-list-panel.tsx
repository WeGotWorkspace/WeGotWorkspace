import { useMemo, type ReactNode, type RefObject } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Archive, Circle, Star } from "lucide-react";
import { CollectionListEnd } from "@/collection-layout/src/collection-list-end";
import { ViewHeader } from "@/view-header/src/view-header";
import { ListItem } from "@/list-item/src/list-item";
import { bindItemDragHandlers } from "@/list-item/src/use-delegated-list-item-events";
import { WorkspaceSwipeList } from "@/workspace-swipe-list/src/workspace-swipe-list";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import type { Mail } from "@/types/mail";
import type { MailUILabels } from "@/mail-core/src/mail-app.stories.fixtures";
import { formatMailDateForList } from "@/mail-core/src/mail-date-utils";

type MailListPanelProps = {
  L: MailUILabels;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  viewLabel: string;
  selectedIds: string[];
  selectionMode: boolean;
  effectiveListLoading: boolean;
  visibleMail: Mail[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  inTrash: boolean;
  isTouch: boolean;
  starred: Record<string, boolean>;
  activeId: string;
  isItemDragging: (id: string) => boolean;
  handleSelect: (id: string, e: ReactMouseEvent) => void;
  handleDoubleClick: (id: string, e: ReactMouseEvent) => void;
  enterSelectionFor: (id: string) => void;
  itemDragHandlers: (id: string) => Record<string, unknown>;
  toggleStar: (id: string) => void;
  moveOne: (id: string, mb: string) => void;
  listEndRef: RefObject<HTMLDivElement | null>;
  isLoadingMore: boolean;
  selectionBar: ReactNode;
};

export function MailListPanel({
  L,
  sidebarOpen,
  onToggleSidebar,
  viewLabel,
  selectedIds,
  selectionMode,
  effectiveListLoading,
  visibleMail,
  searchQuery,
  setSearchQuery,
  searchInputRef,
  inTrash: _inTrash,
  isTouch,
  starred,
  activeId,
  isItemDragging,
  handleSelect,
  handleDoubleClick,
  enterSelectionFor,
  itemDragHandlers,
  toggleStar,
  moveOne,
  listEndRef,
  isLoadingMore,
  selectionBar,
}: MailListPanelProps) {
  return {
    header: (
      <ViewHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        title={viewLabel}
        searchPlaceholder="Search mail..."
        searchValue={searchQuery}
        onSearchInput={setSearchQuery}
        searchInputRef={searchInputRef}
      />
    ),
    listContent: effectiveListLoading ? (
      <div className="mail-list-panel__loading" aria-busy>
        <LoadingSpinner size="lg" label={L.listLoading} />
      </div>
    ) : (
      <>
        <MailListRows
          visibleMail={visibleMail}
          isTouch={isTouch}
          starred={starred}
          activeId={activeId}
          selectedIds={selectedIds}
          selectionMode={selectionMode}
          isItemDragging={isItemDragging}
          handleSelect={handleSelect}
          handleDoubleClick={handleDoubleClick}
          enterSelectionFor={enterSelectionFor}
          itemDragHandlers={itemDragHandlers}
          toggleStar={toggleStar}
          moveOne={moveOne}
        />
        <CollectionListEnd listEndRef={listEndRef} />
        {isLoadingMore ? (
          <div className="mail-list-panel__load-more">
            <LoadingSpinner size="sm" label={L.listLoading} />
          </div>
        ) : null}
      </>
    ),
    hasItems: effectiveListLoading || visibleMail.length > 0,
    emptyLabel: "No messages",
    floatingActionBar: selectionBar,
  };
}

function MailListRows({
  visibleMail,
  isTouch,
  starred,
  activeId,
  selectedIds,
  selectionMode,
  isItemDragging,
  handleSelect,
  handleDoubleClick,
  enterSelectionFor,
  itemDragHandlers,
  toggleStar,
  moveOne,
}: Pick<
  MailListPanelProps,
  | "visibleMail"
  | "isTouch"
  | "starred"
  | "activeId"
  | "selectedIds"
  | "selectionMode"
  | "isItemDragging"
  | "handleSelect"
  | "handleDoubleClick"
  | "enterSelectionFor"
  | "itemDragHandlers"
  | "toggleStar"
  | "moveOne"
>) {
  const rows = useMemo(
    () =>
      visibleMail.map((m) => (
        <ListItem
          key={m.id}
          id={m.id}
          title={m.title}
          subtitle={m.from}
          date={formatMailDateForList(m.date)}
          text={m.excerpt}
          icons={[
            m.unread ? (
              <Circle className="size-2.5 mail-state-accent" fill="currentColor" strokeWidth={0} />
            ) : null,
            starred[m.id] ? (
              <Star className="size-3 mail-state-accent" fill="currentColor" />
            ) : null,
          ].filter(Boolean)}
          isActive={false}
          isSelected={false}
          selectionMode={false}
          isTouch={isTouch}
          isDragging={isItemDragging(m.id)}
          {...(isTouch
            ? {
                swipeLeftAction: {
                  icon: <Star className="size-5" fill={starred[m.id] ? "currentColor" : "none"} />,
                  color: "var(--mail-swipe-star-color)",
                  label: starred[m.id] ? "Unstar" : "Star",
                  onActivate: () => toggleStar(m.id),
                },
                swipeRightAction: {
                  icon: <Archive className="size-5" />,
                  color: "var(--mail-swipe-archive-color)",
                  label: "Archive",
                  destructive: true,
                  onActivate: () => moveOne(m.id, "Archive"),
                },
              }
            : {})}
        />
      )),
    [isItemDragging, isTouch, moveOne, starred, toggleStar, visibleMail],
  );

  return (
    <WorkspaceSwipeList
      isTouch={isTouch}
      activeId={activeId}
      selectedIds={selectedIds}
      selectionMode={selectionMode}
      onItemClick={handleSelect}
      onItemDoubleClick={handleDoubleClick}
      onItemLongPress={enterSelectionFor}
      {...bindItemDragHandlers(itemDragHandlers)}
    >
      {rows}
    </WorkspaceSwipeList>
  );
}
