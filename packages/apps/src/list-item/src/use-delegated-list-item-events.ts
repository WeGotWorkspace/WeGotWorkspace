import {
  useCallback,
  useRef,
  type DragEvent,
  type HTMLAttributes,
  type MouseEvent,
  type TouchEvent,
} from "react";
import { listItemIdFromTarget } from "@/list-item/src/list-item-id";

export const LIST_ITEM_LONG_PRESS_DELAY_MS = 450;
/** A touch that travels further than this, in any direction, is a scroll or a swipe. */
const TOUCH_SLOP_PX = 8;

export type TouchStartPoint = { x: number; y: number };
type TouchPoints = ArrayLike<{ clientX: number; clientY: number }>;

export function touchStartPoint(touches: TouchPoints): TouchStartPoint | null {
  const touch = touches.length > 0 ? touches[0] : undefined;
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

/** True once the finger has moved past the slop: horizontal (swipe) or vertical (scroll). */
export function touchMovedPastSlop(start: TouchStartPoint | null, touches: TouchPoints): boolean {
  const touch = touches.length > 0 ? touches[0] : undefined;
  if (!touch || !start) return false;
  return Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TOUCH_SLOP_PX;
}

export type DelegatedListItemEvents = {
  onItemClick?: (id: string, event: MouseEvent) => void;
  onItemDoubleClick?: (id: string, event: MouseEvent) => void;
  onItemLongPress?: (id: string) => void;
  onItemDragStart?: (id: string, event: DragEvent) => void;
  onItemDragEnd?: (id: string, event: DragEvent) => void;
};

export type UseDelegatedListItemEventsArgs = DelegatedListItemEvents & {
  isTouch: boolean;
};

export function bindItemDragHandlers(
  itemDragHandlers: (id: string) => Record<string, unknown>,
): Pick<DelegatedListItemEvents, "onItemDragStart" | "onItemDragEnd"> {
  return {
    onItemDragStart: (id, event) => {
      const start = itemDragHandlers(id).onDragStart;
      if (typeof start === "function") start(event);
    },
    onItemDragEnd: (id) => {
      const end = itemDragHandlers(id).onDragEnd;
      if (typeof end === "function") end();
    },
  };
}

export function hasDelegatedListItemEvents(events: DelegatedListItemEvents): boolean {
  return Boolean(
    events.onItemClick ||
    events.onItemDoubleClick ||
    events.onItemLongPress ||
    events.onItemDragStart ||
    events.onItemDragEnd,
  );
}

/**
 * One listener set for a list parent. Resolve the row via `data-list-item-id`.
 */
export function useDelegatedListItemEvents({
  isTouch,
  onItemClick,
  onItemDoubleClick,
  onItemLongPress,
  onItemDragStart,
  onItemDragEnd,
}: UseDelegatedListItemEventsArgs): {
  listProps: HTMLAttributes<HTMLDivElement>;
  /** For rows: a swipe began, so this touch is not a long press. */
  cancelPress: () => void;
} {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const touchStartRef = useRef<TouchStartPoint | null>(null);
  const pressIdRef = useRef<string | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }, []);

  const resetTouchIntent = useCallback(() => {
    cancelLongPress();
    touchStartRef.current = null;
    pressIdRef.current = null;
  }, [cancelLongPress]);

  const listProps: HTMLAttributes<HTMLDivElement> = {
    onClick: (event) => {
      const id = listItemIdFromTarget(event.target);
      if (!id) return;
      if (longPressFired.current) {
        event.preventDefault();
        longPressFired.current = false;
        return;
      }
      onItemClick?.(id, event);
    },
    onDoubleClick: (event) => {
      const id = listItemIdFromTarget(event.target);
      if (!id) return;
      onItemDoubleClick?.(id, event);
    },
    onMouseDown: (event) => {
      if (!listItemIdFromTarget(event.target)) return;
      if (event.shiftKey) event.preventDefault();
    },
    onDragStart: (event) => {
      const id = listItemIdFromTarget(event.target);
      if (!id) return;
      onItemDragStart?.(id, event);
    },
    onDragEnd: (event) => {
      const id = listItemIdFromTarget(event.target);
      if (!id) return;
      onItemDragEnd?.(id, event);
    },
    onTouchStart: isTouch
      ? (event: TouchEvent<HTMLDivElement>) => {
          const id = listItemIdFromTarget(event.target);
          if (!id || !onItemLongPress) return;
          pressIdRef.current = id;
          touchStartRef.current = touchStartPoint(event.touches);
          longPressFired.current = false;
          longPressTimer.current = setTimeout(() => {
            const pressedId = pressIdRef.current;
            if (!pressedId) return;
            longPressFired.current = true;
            onItemLongPress(pressedId);
            if ("vibrate" in navigator) navigator.vibrate?.(15);
          }, LIST_ITEM_LONG_PRESS_DELAY_MS);
        }
      : undefined,
    onTouchMove: isTouch
      ? (event: TouchEvent<HTMLDivElement>) => {
          if (touchMovedPastSlop(touchStartRef.current, event.touches)) cancelLongPress();
        }
      : undefined,
    onTouchEnd: isTouch ? resetTouchIntent : undefined,
    onTouchCancel: isTouch ? resetTouchIntent : undefined,
    onContextMenu: isTouch
      ? (event) => {
          if (listItemIdFromTarget(event.target)) event.preventDefault();
        }
      : undefined,
  };

  return { listProps, cancelPress: resetTouchIntent };
}
