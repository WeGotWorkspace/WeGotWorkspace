import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { SwipeableList, Type as SwipeListType } from "react-swipeable-list";
import { ListItemEventDelegationContext } from "@/list-item/src/list-item-delegation";
import { ListSelectionProvider } from "@/list-item/src/list-item-selection";
import {
  hasDelegatedListItemEvents,
  useDelegatedListItemEvents,
  type DelegatedListItemEvents,
} from "@/list-item/src/use-delegated-list-item-events";

type SwipeItemIdProps = { id?: string; itemId?: string };

/** Copy `id` onto `itemId` before SwipeableList overwrites `id` with `listItem-${index}`. */
function preserveSwipeItemId(child: ReactNode): ReactNode {
  if (!isValidElement<SwipeItemIdProps>(child)) return child;
  const entityId = child.props.itemId ?? child.props.id;
  if (!entityId) return child;
  return cloneElement(child as ReactElement<SwipeItemIdProps>, { itemId: entityId });
}

export type WorkspaceSwipeListProps = DelegatedListItemEvents & {
  isTouch: boolean;
  children: ReactNode;
  activeId?: string;
  selectedIds?: readonly string[];
  selectionMode?: boolean;
};

/** Wraps children in `SwipeableList` on touch; owns list-level item events when provided. */
export function WorkspaceSwipeList({
  isTouch,
  children,
  onItemClick,
  onItemDoubleClick,
  onItemLongPress,
  onItemDragStart,
  onItemDragEnd,
  activeId = "",
  selectedIds = [],
  selectionMode = false,
}: WorkspaceSwipeListProps) {
  const events = {
    onItemClick,
    onItemDoubleClick,
    onItemLongPress,
    onItemDragStart,
    onItemDragEnd,
  };
  const delegate = hasDelegatedListItemEvents(events);
  const listProps = useDelegatedListItemEvents({ isTouch, ...events });
  const swipeChildren = Children.toArray(children).map(preserveSwipeItemId);
  const body = isTouch ? (
    <SwipeableList type={SwipeListType.IOS} fullSwipe>
      {swipeChildren}
    </SwipeableList>
  ) : (
    children
  );

  const framed = delegate ? (
    <ListItemEventDelegationContext.Provider value>
      <div className="workspace-swipe-list" {...listProps}>
        {body}
      </div>
    </ListItemEventDelegationContext.Provider>
  ) : (
    body
  );

  return (
    <ListSelectionProvider
      activeId={activeId}
      selectedIds={selectedIds}
      selectionMode={selectionMode}
    >
      {framed}
    </ListSelectionProvider>
  );
}
