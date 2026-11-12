import { useCallback, useEffect, useRef } from "react";
import { listItemFocusTarget, listItemIdOf } from "@/hooks/list-item-focus";

type UseListKeyboardNavigationArgs = {
  visibleIds: string[];
  activeId: string;
  selectedIds: string[];
  setActiveId: (id: string) => void;
  setSelectionMode: (value: boolean) => void;
  setSelectedIds: (ids: string[]) => void;
  onNavigateToId?: (id: string) => void;
  itemSelector?: string;
  /**
   * The range mouse clicks built (`useSelectableListState`): its anchor and its
   * moving end. Shift+Arrow grows that range, and the keys report the range back,
   * so a later shift-click starts where the keys left off.
   */
  rangeAnchorId?: string;
  rangeEndId?: string;
  onRangeChange?: (anchorId: string, endId: string) => void;
};

export function useListKeyboardNavigation({
  visibleIds,
  activeId,
  selectedIds,
  setActiveId,
  setSelectionMode,
  setSelectedIds,
  onNavigateToId,
  itemSelector = "[data-list-item-id]",
  rangeAnchorId,
  rangeEndId,
  onRangeChange,
}: UseListKeyboardNavigationArgs) {
  const keyboardAnchorIdRef = useRef<string | null>(null);

  const scrollListItemIntoView = useCallback(
    (id: string) => {
      if (typeof document === "undefined") return;
      requestAnimationFrame(() => {
        const target = Array.from(document.querySelectorAll<HTMLElement>(itemSelector)).find(
          (node) => node.getAttribute("data-list-item-id") === id,
        );
        target?.scrollIntoView({ block: "nearest" });
        // Keyboard focus in the list follows the selection (a screen reader reads it).
        if (target && listItemIdOf(document.activeElement)) {
          listItemFocusTarget(target)?.focus({ preventScroll: true });
        }
      });
    },
    [itemSelector],
  );

  const navigateListByKeyboard = useCallback(
    (direction: -1 | 1, extendSelection: boolean) => {
      if (visibleIds.length === 0) return;
      const currentIndex = activeId ? visibleIds.indexOf(activeId) : -1;
      const fallbackIndex = direction > 0 ? 0 : visibleIds.length - 1;
      if (!extendSelection) {
        keyboardAnchorIdRef.current = null;
        const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
        const nextIndex = Math.min(visibleIds.length - 1, Math.max(0, baseIndex + direction));
        const nextId = visibleIds[nextIndex];
        if (!nextId) return;
        setSelectionMode(false);
        setSelectedIds([nextId]);
        setActiveId(nextId);
        onRangeChange?.(nextId, nextId);
        scrollListItemIntoView(nextId);
        onNavigateToId?.(nextId);
        return;
      }

      // Shift+Arrow (or Space held): the anchor stays put and the moving end steps,
      // so the range can grow, shrink, and cross the anchor (Finder / Mail). The
      // range is the one the mouse built when it is still selected (a shift-click
      // moves the end, a Cmd-click starts a new range); rows picked outside it with
      // Cmd-click stay selected.
      const isSelected = (id: string | null | undefined): id is string =>
        !!id && visibleIds.includes(id) && selectedIds.includes(id);
      const singleId = selectedIds.length <= 1 ? (selectedIds[0] ?? activeId) : null;
      const anchorId = singleId
        ? visibleIds.includes(singleId)
          ? singleId
          : visibleIds[fallbackIndex]
        : isSelected(rangeAnchorId)
          ? rangeAnchorId
          : isSelected(keyboardAnchorIdRef.current)
            ? keyboardAnchorIdRef.current
            : isSelected(activeId)
              ? activeId
              : (selectedIds.find((id) => visibleIds.includes(id)) ?? visibleIds[fallbackIndex]);
      if (!anchorId) return;
      keyboardAnchorIdRef.current = anchorId;
      const anchorIndex = visibleIds.indexOf(anchorId);
      if (anchorIndex < 0) return;

      const endId = singleId
        ? anchorId
        : isSelected(rangeEndId)
          ? rangeEndId
          : isSelected(activeId)
            ? activeId
            : anchorId;
      const edgeIndex = visibleIds.indexOf(endId);
      const nextEdgeIndex = Math.min(visibleIds.length - 1, Math.max(0, edgeIndex + direction));
      const previousRange = new Set(
        visibleIds.slice(Math.min(anchorIndex, edgeIndex), Math.max(anchorIndex, edgeIndex) + 1),
      );
      const nextRange = new Set(
        visibleIds.slice(
          Math.min(anchorIndex, nextEdgeIndex),
          Math.max(anchorIndex, nextEdgeIndex) + 1,
        ),
      );
      const kept = new Set(selectedIds.filter((id) => !previousRange.has(id)));
      const nextSelection = visibleIds.filter((id) => nextRange.has(id) || kept.has(id));
      const nextId = visibleIds[nextEdgeIndex];
      if (!nextId) return;

      setSelectionMode(true);
      setSelectedIds(nextSelection);
      setActiveId(nextId);
      onRangeChange?.(anchorId, nextId);
      scrollListItemIntoView(nextId);
      onNavigateToId?.(nextId);
    },
    [
      visibleIds,
      activeId,
      selectedIds,
      setSelectionMode,
      setSelectedIds,
      setActiveId,
      scrollListItemIntoView,
      onNavigateToId,
      rangeAnchorId,
      rangeEndId,
      onRangeChange,
    ],
  );

  useEffect(() => {
    if (selectedIds.length <= 1) {
      keyboardAnchorIdRef.current = selectedIds[0] ?? null;
    }
  }, [selectedIds]);

  return { navigateListByKeyboard };
}
