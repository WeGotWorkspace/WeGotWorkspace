import { useEffect, useRef } from "react";
import { findListScroller } from "@/workspace-list/src/use-workspace-list-scroll";
import { WORKSPACE_LIST_OVERSCAN_PX } from "@/workspace-list/src/workspace-list-window";

function rowElement(list: HTMLElement, id: string): HTMLElement | null {
  for (const node of list.querySelectorAll<HTMLElement>("[data-list-item-id]")) {
    if (node.getAttribute("data-list-item-id") === id) return node;
  }
  return null;
}

/**
 * Scrolls a newly active row into view (`revealActive`), once per active id.
 * Scrolling the list later never pulls it back. A row near the view scrolls the
 * least it needs; a far one lands at the top, as Contacts always did. The active row is always mounted
 * (pinned), so the row is in the DOM even far outside the window. When the row
 * is not there yet (rows still loading) or the list has no height (a hidden
 * pane), it tries again on the next change.
 */
export function useWorkspaceListReveal(
  listRef: { current: HTMLElement | null },
  activeId: string,
  keys: readonly string[],
  enabled: boolean,
) {
  const revealedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || revealedRef.current === activeId) return;
    if (!activeId) {
      revealedRef.current = activeId;
      return;
    }
    const list = listRef.current;
    const scroller = findListScroller(list);
    if (!list || !scroller || scroller.clientHeight <= 0) return;
    const row = rowElement(list, activeId);
    if (!row) return;
    revealedRef.current = activeId;
    const box = row.getBoundingClientRect();
    const port = scroller.getBoundingClientRect();
    const far =
      box.bottom < port.top - WORKSPACE_LIST_OVERSCAN_PX ||
      box.top > port.bottom + WORKSPACE_LIST_OVERSCAN_PX;
    row.scrollIntoView({ block: far ? "start" : "nearest" });
  }, [activeId, enabled, keys, listRef]);
}
