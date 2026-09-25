import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Circle, Trash2, UserMinus } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { ListItem } from "@/list-item/src/list-item";
import { ListStickyHeader } from "@/list-sticky-header/src/list-sticky-header";
import { ViewHeader } from "@/view-header/src/view-header";
import { ContactUserAvatar } from "./contact-user-avatar";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { RefreshSpinIcon } from "@/refresh-spin/src/refresh-spin-icon";
import { useListReorderAnimation } from "@/hooks/use-list-reorder-animation";
import { bindItemDragHandlers } from "@/list-item/src/use-delegated-list-item-events";
import { WorkspaceSwipeList } from "@/workspace-swipe-list/src/workspace-swipe-list";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  contactDisplayName,
  contactListDetail,
  contactListSubtitle,
} from "@/contacts-core/src/contacts-display-utils";
import {
  contactListRowOffset,
  contactsListWindowRange,
  contactListWindowSlice,
  flattenContactListRows,
  type ContactsListWindowRow,
} from "@/contacts-core/src/contacts-list-window";
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
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => flattenContactListRows(visibleCards), [visibleCards]);
  const windowRange = useContactsListWindow(listRef, rows, activeId);
  const windowSlice = contactListWindowSlice(rows, windowRange);
  // Measure against the full visible set. A moving window changes which rows
  // are mounted, and feeding only those ids looks like a reorder.
  useListReorderAnimation(
    listRef,
    visibleCards.map((card) => card.id),
  );

  const headerCount =
    selectionMode || selectedIds.length > 1 ? selectedIds.length : visibleCards.length;
  const headerCountLabel =
    selectionMode || selectedIds.length > 1
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
      />
    ),
    listContent: listLoading ? (
      <div className="contacts-list-panel__loading" aria-busy>
        <LoadingSpinner size="lg" label={L.listLoading} />
      </div>
    ) : (
      <div ref={listRef} className="contacts-list-panel__list">
        <ContactsListRows
          L={L}
          rows={windowSlice.rows}
          paddingTop={windowSlice.paddingTop}
          paddingBottom={windowSlice.paddingBottom}
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
      </div>
    ),
    hasItems: listLoading || visibleCards.length > 0,
    emptyLabel: view.startsWith("group:") ? L.emptyGroupMembers : L.emptyList,
    floatingActionBar: selectionBar,
  };
}

function useContactsListWindow(
  listRef: RefObject<HTMLDivElement | null>,
  rows: ContactsListWindowRow[],
  activeId: string,
) {
  const [metrics, setMetrics] = useState({ scrollTop: 0, viewportHeight: 0 });

  useLayoutEffect(() => {
    const scroller = listRef.current?.parentElement;
    if (!scroller) return;
    const update = () => {
      setMetrics({ scrollTop: scroller.scrollTop, viewportHeight: scroller.clientHeight });
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [listRef, rows.length]);

  const range = contactsListWindowRange(rows, metrics.scrollTop, metrics.viewportHeight);
  const scrolledForActiveIdRef = useRef<string | null>(null);
  const pendingScrollIntoViewIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Scrolling changes the window. Only a new selection should move the list.
    if (scrolledForActiveIdRef.current === activeId) return;
    if (!activeId) {
      scrolledForActiveIdRef.current = activeId;
      pendingScrollIntoViewIdRef.current = null;
      return;
    }
    const index = rows.findIndex((row) => row.kind === "card" && row.card.id === activeId);
    if (index < 0) return;
    const scroller = listRef.current?.parentElement;
    if (!scroller || scroller.clientHeight <= 0) return;
    scrolledForActiveIdRef.current = activeId;
    const node = activeRowElement(listRef.current, activeId);
    if (node && index >= range.start && index < range.end) {
      node.scrollIntoView({ block: "nearest" });
      return;
    }
    const offset = contactListRowOffset(rows, index);
    scroller.scrollTop = offset;
    pendingScrollIntoViewIdRef.current = activeId;
    setMetrics({ scrollTop: offset, viewportHeight: scroller.clientHeight });
  }, [activeId, listRef, range.end, range.start, rows]);

  useEffect(() => {
    const id = pendingScrollIntoViewIdRef.current;
    if (!id) return;
    const node = activeRowElement(listRef.current, id);
    if (!node) return;
    pendingScrollIntoViewIdRef.current = null;
    node.scrollIntoView({ block: "nearest" });
  }, [activeId, listRef, range.end, range.start, rows]);

  return range;
}

function activeRowElement(list: HTMLElement | null, id: string): HTMLElement | null {
  if (!list) return null;
  for (const node of list.querySelectorAll<HTMLElement>("[data-list-item-id]")) {
    if (node.getAttribute("data-list-item-id") === id) return node;
  }
  return null;
}

function ContactsListRows({
  L,
  rows,
  paddingTop,
  paddingBottom,
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
}: {
  rows: ContactsListWindowRow[];
  paddingTop: number;
  paddingBottom: number;
} & Pick<
  ContactsListPanelProps,
  | "L"
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
  const rendered = useMemo(() => {
    const blocks: ReactNode[] = [];
    let sectionLetter = "";
    let sectionCards: ContactCard[] = [];

    const flush = () => {
      if (!sectionLetter && sectionCards.length === 0) return;
      const letter = sectionLetter || "#";
      blocks.push(
        <section key={letter} aria-labelledby={`contacts-section-${letter}`}>
          <ListStickyHeader id={`contacts-section-${letter}`} emphasis={letter} />
          {sectionCards.map((card) => {
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
                    size="md"
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
        </section>,
      );
      sectionCards = [];
    };

    for (const row of rows) {
      if (row.kind === "header") {
        flush();
        sectionLetter = row.letter;
        continue;
      }
      sectionCards.push(row.card);
    }
    flush();
    return blocks;
  }, [
    L.pendingSync,
    L.swipeDelete,
    L.swipeRemoveFromGroup,
    L.unknownContact,
    isItemDragging,
    isTouch,
    onSwipeDelete,
    onSwipeRemoveFromGroup,
    pendingCardIds,
    rows,
    selectedGroupId,
  ]);

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
      {paddingTop > 0 ? (
        <div className="contacts-list-panel__spacer" style={{ height: paddingTop }} />
      ) : null}
      {rendered}
      {paddingBottom > 0 ? (
        <div className="contacts-list-panel__spacer" style={{ height: paddingBottom }} />
      ) : null}
    </WorkspaceSwipeList>
  );
}
