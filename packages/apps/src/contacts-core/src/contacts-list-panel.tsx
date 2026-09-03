import { useMemo, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { Circle, RefreshCw, Trash2, UserMinus } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { ListItem } from "@/list-item/src/list-item";
import { ViewHeader } from "@/view-header/src/view-header";
import { ContactUserAvatar } from "./contact-user-avatar";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { bindItemDragHandlers } from "@/list-item/src/use-delegated-list-item-events";
import { WorkspaceSwipeList } from "@/workspace-swipe-list/src/workspace-swipe-list";
import { cn } from "@/lib/utils";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  contactDisplayName,
  contactListDetail,
  contactListSubtitle,
  groupContactCardsBySection,
} from "@/contacts-core/src/contacts-display-utils";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";

type ContactsListPanelProps = {
  L: ContactsUILabels;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  viewLabel: string;
  view: string;
  selectedGroupId: string | null;
  selectedIds: string[];
  selectionMode: boolean;
  listLoading: boolean;
  listRefreshing?: boolean;
  visibleCards: ContactCard[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  isTouch: boolean;
  activeId: string;
  isItemDragging: (id: string) => boolean;
  handleSelect: (id: string, e: ReactMouseEvent) => void;
  enterSelectionFor: (id: string) => void;
  itemDragHandlers: (id: string) => Record<string, unknown>;
  onSwipeDelete: (id: string) => void;
  onSwipeRemoveFromGroup: (id: string) => void;
  selectionBar: ReactNode;
  onRefreshList?: () => void;
  /** Card ids with unsynced local changes; rendered with a subtle pending-sync dot. */
  pendingCardIds?: ReadonlySet<string>;
};

export function ContactsListPanel({
  L,
  sidebarOpen,
  onToggleSidebar,
  viewLabel,
  view,
  selectedGroupId,
  selectedIds,
  selectionMode,
  listLoading,
  listRefreshing = false,
  visibleCards,
  searchQuery,
  setSearchQuery,
  searchInputRef,
  isTouch,
  activeId,
  isItemDragging,
  handleSelect,
  enterSelectionFor,
  itemDragHandlers,
  onSwipeDelete,
  onSwipeRemoveFromGroup,
  selectionBar,
  onRefreshList,
  pendingCardIds,
}: ContactsListPanelProps) {
  return {
    header: (
      <ViewHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        title={viewLabel}
        subtitle={
          selectionMode || selectedIds.length > 1
            ? L.listSelected(selectedIds.length)
            : L.listContacts(visibleCards.length)
        }
        actions={
          onRefreshList ? (
            <IconButton
              label={L.refreshList}
              onClick={onRefreshList}
              disabled={listLoading || listRefreshing}
              icon={
                <RefreshCw className={cn("size-4", listRefreshing && "animate-spin")} aria-hidden />
              }
              size="sm"
              variant="subtle"
            />
          ) : null
        }
        searchPlaceholder={L.searchPlaceholder}
        searchValue={searchQuery}
        onSearchInput={setSearchQuery}
        searchInputRef={searchInputRef}
      />
    ),
    listContent: (
      <>
        {listLoading ? (
          <div className="contacts-list-panel__loading" aria-busy>
            <LoadingSpinner size="lg" label={L.listLoading} />
          </div>
        ) : (
          <ContactsListRows
            L={L}
            visibleCards={visibleCards}
            isTouch={isTouch}
            activeId={activeId}
            selectedIds={selectedIds}
            selectionMode={selectionMode}
            selectedGroupId={selectedGroupId}
            isItemDragging={isItemDragging}
            handleSelect={handleSelect}
            enterSelectionFor={enterSelectionFor}
            itemDragHandlers={itemDragHandlers}
            onSwipeDelete={onSwipeDelete}
            onSwipeRemoveFromGroup={onSwipeRemoveFromGroup}
            pendingCardIds={pendingCardIds}
          />
        )}
      </>
    ),
    hasItems: listLoading || visibleCards.length > 0,
    emptyLabel: view.startsWith("group:") ? L.emptyGroupMembers : L.emptyList,
    floatingActionBar: selectionBar,
  };
}

function ContactsListRows({
  L,
  visibleCards,
  isTouch,
  activeId,
  selectedIds,
  selectionMode,
  selectedGroupId,
  isItemDragging,
  handleSelect,
  enterSelectionFor,
  itemDragHandlers,
  onSwipeDelete,
  onSwipeRemoveFromGroup,
  pendingCardIds,
}: Pick<
  ContactsListPanelProps,
  | "L"
  | "visibleCards"
  | "isTouch"
  | "activeId"
  | "selectedIds"
  | "selectionMode"
  | "selectedGroupId"
  | "isItemDragging"
  | "handleSelect"
  | "enterSelectionFor"
  | "itemDragHandlers"
  | "onSwipeDelete"
  | "onSwipeRemoveFromGroup"
  | "pendingCardIds"
>) {
  const rows = useMemo(
    () =>
      groupContactCardsBySection(visibleCards).map((section) => (
        <section key={section.letter} aria-labelledby={`contacts-section-${section.letter}`}>
          <div
            id={`contacts-section-${section.letter}`}
            className="contacts-list-panel__section-header"
          >
            {section.letter}
          </div>
          {section.cards.map((card) => {
            const name = contactDisplayName(card);
            const isPendingSync = pendingCardIds?.has(card.id) ?? false;
            return (
              <ListItem
                key={card.id}
                id={card.id}
                title={name}
                subtitle={contactListSubtitle(card)}
                metaPosition="below"
                date=""
                text={contactListDetail(card)}
                icons={[
                  isPendingSync ? (
                    <span
                      className="contacts-list-panel__pending-dot"
                      role="img"
                      aria-label={L.pendingSync}
                    >
                      <Circle className="size-2.5" fill="currentColor" strokeWidth={0} />
                    </span>
                  ) : null,
                ].filter(Boolean)}
                leading={
                  <ContactUserAvatar
                    card={card}
                    compact
                    size="sm"
                    className="contacts-list-panel__avatar"
                    loading="lazy"
                    decoding="async"
                  />
                }
                isActive={false}
                isSelected={false}
                selectionMode={false}
                isTouch={isTouch}
                isDragging={isItemDragging(card.id)}
                emptyTitle={L.unknownContact}
                {...(isTouch
                  ? selectedGroupId
                    ? {
                        swipeRightAction: {
                          icon: <UserMinus className="size-5" />,
                          color: "var(--contacts-swipe-remove-color)",
                          label: L.swipeRemoveFromGroup,
                          onActivate: () => onSwipeRemoveFromGroup(card.id),
                        },
                      }
                    : {
                        swipeRightAction: {
                          icon: <Trash2 className="size-5" />,
                          color: "var(--contacts-swipe-delete-color)",
                          label: L.swipeDelete,
                          onActivate: () => onSwipeDelete(card.id),
                        },
                      }
                  : {})}
              />
            );
          })}
        </section>
      )),
    [
      L.pendingSync,
      L.swipeDelete,
      L.swipeRemoveFromGroup,
      L.unknownContact,
      isItemDragging,
      isTouch,
      onSwipeDelete,
      onSwipeRemoveFromGroup,
      pendingCardIds,
      selectedGroupId,
      visibleCards,
    ],
  );

  return (
    <WorkspaceSwipeList
      isTouch={isTouch}
      activeId={activeId}
      selectedIds={selectedIds}
      selectionMode={selectionMode}
      onItemClick={handleSelect}
      onItemLongPress={enterSelectionFor}
      {...bindItemDragHandlers(itemDragHandlers)}
    >
      {rows}
    </WorkspaceSwipeList>
  );
}
