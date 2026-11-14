import { useLayoutEffect, useState } from "react";
import { listItemIdOf } from "@/hooks/list-item-focus";

/**
 * Rows the window must keep mounted while they are out of view:
 * - the row that holds focus, so scrolling away does not drop focus to the page;
 * - the row being dragged, because `dragend` fires on the source element and an
 *   unmounted source never ends its drag.
 */
export function useWorkspaceListPinnedKeys(listNode: HTMLElement | null, enabled: boolean) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!listNode || !enabled) return;
    const onFocusIn = (event: FocusEvent) => setFocusedKey(listItemIdOf(event.target));
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !listNode.contains(next)) setFocusedKey(null);
    };
    const onDragStart = (event: DragEvent) => setDraggingKey(listItemIdOf(event.target));
    const onDragEnd = () => setDraggingKey(null);
    listNode.addEventListener("focusin", onFocusIn);
    listNode.addEventListener("focusout", onFocusOut);
    listNode.addEventListener("dragstart", onDragStart, true);
    // `dragend` comes after the drop (or Escape) and reaches the window from the
    // source row, which stays mounted until then. Clearing on `drop` would unmount
    // it first and lose the app's own `dragend`.
    window.addEventListener("dragend", onDragEnd, true);
    return () => {
      listNode.removeEventListener("focusin", onFocusIn);
      listNode.removeEventListener("focusout", onFocusOut);
      listNode.removeEventListener("dragstart", onDragStart, true);
      window.removeEventListener("dragend", onDragEnd, true);
    };
  }, [enabled, listNode]);

  return { focusedKey, draggingKey };
}
