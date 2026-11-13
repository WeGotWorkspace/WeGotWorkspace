import { useCallback, useMemo, useRef, useState } from "react";
import {
  WORKSPACE_LIST_WINDOW_AFTER,
  listWindowSegments,
  sectionHeaderIndex,
  type ListWindowSegment,
} from "@/workspace-list/src/workspace-list-window";
import { useWorkspaceListScroll } from "@/workspace-list/src/use-workspace-list-scroll";
import {
  useMeasureMountedRows,
  useWorkspaceListRowSizes,
} from "@/workspace-list/src/use-workspace-list-measure";
import { useWorkspaceListPinnedKeys } from "@/workspace-list/src/use-workspace-list-pinned";

export type UseWorkspaceListWindowArgs<T> = {
  items: readonly T[];
  keys: readonly string[];
  estimateSize: (item: T) => number;
  isHeader?: (item: T) => boolean;
  /** Ids to keep mounted out of view: the active row, and any the app adds. */
  pinnedKeys: readonly string[];
  /** Window only above this many items (default 80). */
  windowAfter?: number;
  /**
   * The row key of an item id read from the DOM (`data-list-item-id` of the focused
   * or dragged item). A row that holds several items (a grid's tile row) maps each
   * tile to its row; by default the id is the key.
   */
  keyOfItemId?: (id: string) => string | undefined;
};

const NO_SEGMENTS: ListWindowSegment[] = [];

/**
 * Which rows of a long list to mount, and the spacers between them. Short lists
 * (80 rows or fewer) mount every row, exactly as without windowing.
 */
export function useWorkspaceListWindow<T>({
  items,
  keys,
  estimateSize,
  isHeader,
  pinnedKeys,
  windowAfter = WORKSPACE_LIST_WINDOW_AFTER,
  keyOfItemId,
}: UseWorkspaceListWindowArgs<T>) {
  const enabled = items.length > windowAfter;
  const listRef = useRef<HTMLElement | null>(null);
  const [listNode, setListNode] = useState<HTMLElement | null>(null);
  const attachList = useCallback((node: HTMLElement | null) => {
    listRef.current = node;
    setListNode(node);
  }, []);

  const estimateRef = useRef(estimateSize);
  estimateRef.current = estimateSize;
  const estimates = useMemo(
    () => (enabled ? items.map((item) => estimateRef.current(item)) : []),
    [enabled, items],
  );
  const { offsets, measuredRef, bump } = useWorkspaceListRowSizes(keys, estimates, enabled);
  const { scroller, range } = useWorkspaceListScroll(listNode, offsets, enabled);
  const { focusedKey, draggingKey } = useWorkspaceListPinnedKeys(listNode, enabled);

  const keyIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (enabled) keys.forEach((key, index) => map.set(key, index));
    return map;
  }, [enabled, keys]);

  const isHeaderRef = useRef(isHeader);
  isHeaderRef.current = isHeader;
  const keyOfItemIdRef = useRef(keyOfItemId);
  keyOfItemIdRef.current = keyOfItemId;
  const segments = useMemo(() => {
    if (!enabled) return NO_SEGMENTS;
    const headerAt = isHeaderRef.current
      ? (index: number) => isHeaderRef.current!(items[index]!)
      : undefined;
    // A sticky section header stays mounted while rows of its section are: the
    // first mounted section's, and the section of every pinned row.
    const pinned: number[] = [];
    const pin = (index: number) => {
      pinned.push(index);
      const header = sectionHeaderIndex(index, headerAt);
      if (header >= 0 && header !== index) pinned.push(header);
    };
    const indexOf = (key: string | null | undefined) => (key ? keyIndex.get(key) : undefined);
    const indexOfItem = (id: string | null) =>
      id ? indexOf(keyOfItemIdRef.current ? keyOfItemIdRef.current(id) : id) : undefined;
    for (const key of pinnedKeys) {
      const index = indexOf(key);
      if (index !== undefined) pin(index);
    }
    const dragging = indexOfItem(draggingKey);
    if (dragging !== undefined) pin(dragging);
    // The focused row and its neighbours: keys that step to the next row in the
    // DOM (a picker) find the right one even after the list scrolled away.
    const focused = indexOfItem(focusedKey);
    if (focused !== undefined) {
      // Section headings are not items, so step past them to the nearest item row.
      let before = focused - 1;
      while (before >= 0 && headerAt?.(before)) before -= 1;
      if (before >= 0) pin(before);
      pin(focused);
      let after = focused + 1;
      while (after < items.length && headerAt?.(after)) after += 1;
      if (after < items.length) pin(after);
    }
    if (range.end > range.start) pin(range.start);
    return listWindowSegments(offsets, range, pinned);
  }, [draggingKey, enabled, focusedKey, items, keyIndex, offsets, pinnedKeys, range]);

  const renderedIndexes = useMemo(() => {
    const indexes: number[] = [];
    for (const segment of segments) {
      if (segment.kind !== "rows") continue;
      for (let index = segment.start; index < segment.end; index += 1) indexes.push(index);
    }
    return indexes;
  }, [segments]);

  useMeasureMountedRows({
    listNode,
    scroller,
    enabled,
    renderedIndexes,
    keys,
    estimates,
    offsets,
    measuredRef,
    bump,
  });

  return { attachList, listRef, enabled, segments, mounted: renderedIndexes.length };
}
