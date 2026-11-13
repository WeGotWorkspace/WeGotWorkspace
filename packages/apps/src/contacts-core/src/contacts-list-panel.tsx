import {
  useCallback,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Users } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { ListStickyHeader } from "@/list-sticky-header/src/list-sticky-header";
import { ViewHeader } from "@/view-header/src/view-header";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { RefreshSpinIcon } from "@/refresh-spin/src/refresh-spin-icon";
import { bindItemDragHandlers } from "@/list-item/src/use-delegated-list-item-events";
import { WorkspaceList } from "@/workspace-list/src/workspace-list";
import type { ContactCard } from "@/lib/models/contacts-types";
import {
  contactListBook,
  contactListRowHeight,
  flattenContactListRows,
  readContactsListRootFontSizePx,
  type ContactsListRowItem,
} from "@/contacts-core/src/contacts-list-rows";
import { ContactsListRow } from "@/contacts-core/src/contacts-list-row";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import type { ContactsAddressBookSelectBook } from "@/contacts-core/src/contacts-address-book-select";

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
  /** All Contacts' total while the first download runs; the header shows it instead of the rows loaded. */
  downloadTotal?: number;
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
  /** Address books, so each row can name its book (dot + name), as Notes rows do. */
  addressBooks?: readonly ContactsAddressBookSelectBook[];
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
  downloadTotal,
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
  addressBooks,
}: ContactsListPanelProps) {
  const multiSelecting = selectionMode || selectedIds.length > 1;
  const headerCount = multiSelecting ? selectedIds.length : (downloadTotal ?? visibleCards.length);
  const headerCountLabel = multiSelecting
    ? L.listSelected(headerCount)
    : L.listContacts(headerCount);

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
          onRefreshList ? (
            <IconButton
              label={L.refreshList}
              onClick={onRefreshList}
              disabled={listLoading || listRefreshing}
              icon={<RefreshSpinIcon spinning={listRefreshing} className="size-4" />}
              size="md"
              variant="outline"
            />
          ) : null
        }
        searchPlaceholder={L.searchPlaceholder}
        searchValue={searchQuery}
        onSearchInput={setSearchQuery}
        searchInputRef={searchInputRef}
        searchHidden={multiSelecting}
      />
    ),
    listContent: listLoading ? (
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
        addressBooks={addressBooks}
      />
    ),
    hasItems: listLoading || visibleCards.length > 0,
    emptyLabel: view.startsWith("group:") ? L.emptyGroupMembers : L.emptyList,
    emptyIcon: <Users className="size-12" />,
    floatingActionBar: selectionBar,
  };
}

function contactRowKey(row: ContactsListRowItem): string {
  return row.key;
}

function isContactHeaderRow(row: ContactsListRowItem): boolean {
  return row.kind === "header";
}

function contactSectionId(letter: string): string {
  return `contacts-section-${letter || "#"}`;
}

/** A letter section: the sticky header sticks for exactly its own cards. */
function renderContactSection(header: ContactsListRowItem, content: ReactNode[]) {
  const letter = header.kind === "header" ? header.letter : "";
  return <section aria-labelledby={contactSectionId(letter)}>{content}</section>;
}

/**
 * The cards under their letter headers, through the suite's shared list: above
 * 80 rows only the rows near the scrollport are mounted (#1641 step d).
 */
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
  addressBooks,
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
  | "addressBooks"
>) {
  const rows = useMemo(() => flattenContactListRows(visibleCards), [visibleCards]);
  // Read once: a style read on every render forces a style recalc while the book
  // downloads page by page. A later font change is corrected by measured rows.
  const [rootFontSizePx] = useState(readContactsListRootFontSizePx);
  const estimateSize = useCallback(
    (row: ContactsListRowItem) => contactListRowHeight(row, rootFontSizePx),
    [rootFontSizePx],
  );
  const inGroup = Boolean(selectedGroupId);
  const renderRow = useCallback(
    (row: ContactsListRowItem) => {
      if (row.kind === "header") {
        return (
          <ListStickyHeader
            id={contactSectionId(row.letter)}
            emphasis={row.letter || "#"}
            variant="frost"
          />
        );
      }
      const { card } = row;
      return (
        <ContactsListRow
          L={L}
          card={card}
          book={contactListBook(card, addressBooks)}
          isPendingSync={pendingCardIds?.has(card.id) ?? false}
          isTouch={isTouch}
          isDragging={isItemDragging(card.id)}
          inGroup={inGroup}
          onSwipeDelete={onSwipeDelete}
          onSwipeRemoveFromGroup={onSwipeRemoveFromGroup}
        />
      );
    },
    [
      L,
      addressBooks,
      inGroup,
      isItemDragging,
      isTouch,
      onSwipeDelete,
      onSwipeRemoveFromGroup,
      pendingCardIds,
    ],
  );

  return (
    <WorkspaceList
      className="contacts-list-panel__list"
      items={rows}
      getKey={contactRowKey}
      renderItem={renderRow}
      estimateSize={estimateSize}
      isHeader={isContactHeaderRow}
      renderSection={renderContactSection}
      revealActive
      isTouch={isTouch}
      activeId={activeId}
      selectedIds={selectedIds}
      selectionMode={selectionMode}
      onItemClick={handleSelect}
      onItemLongPress={enterSelectionFor}
      {...bindItemDragHandlers(itemDragHandlers)}
    />
  );
}
