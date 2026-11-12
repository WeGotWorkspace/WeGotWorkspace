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
}: UseWorkspaceListWindowArgs<T>) {
  const enabled = items.length > WORKSPACE_LIST_WINDOW_AFTER;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [listNode, setListNode] = useState<HTMLDivElement | null>(null);
  const attachList = useCallback((node: HTMLDivElement | null) => {
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
  const segments = useMemo(() => {
    if (!enabled) return NO_SEGMENTS;
    const pinned: number[] = [];
    for (const key of [...pinnedKeys, focusedKey, draggingKey]) {
      const index = key ? keyIndex.get(key) : undefined;
      if (index !== undefined) pinned.push(index);
    }
    const headerAt = isHeaderRef.current
      ? (index: number) => isHeaderRef.current!(items[index]!)
      : undefined;
    // A sticky section header stays mounted while rows of its section are.
    const header = sectionHeaderIndex(range.start, headerAt);
    if (header >= 0) pinned.push(header);
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
