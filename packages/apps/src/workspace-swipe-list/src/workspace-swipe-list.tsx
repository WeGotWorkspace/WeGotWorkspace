import { Children, isValidElement, type ReactNode } from "react";
import { SwipeableList, Type as SwipeListType } from "react-swipeable-list";
import { ListItemEventDelegationContext } from "@/list-item/src/list-item-delegation";
import {
  hasDelegatedListItemEvents,
  useDelegatedListItemEvents,
  type DelegatedListItemEvents,
} from "@/list-item/src/use-delegated-list-item-events";

export type WorkspaceSwipeListProps = DelegatedListItemEvents & {
  isTouch: boolean;
  children: ReactNode;
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
  const swipeChildren = Children.toArray(children).filter((child) => isValidElement(child));
  const body = isTouch ? (
    <SwipeableList type={SwipeListType.IOS} fullSwipe>
      {swipeChildren}
    </SwipeableList>
  ) : (
    children
  );

  if (!delegate) {
    return <>{body}</>;
  }

  return (
    <ListItemEventDelegationContext.Provider value>
      <div className="workspace-swipe-list" {...listProps}>
        {body}
      </div>
    </ListItemEventDelegationContext.Provider>
  );
}
