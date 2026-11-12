import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listRowOffsets } from "@/workspace-list/src/workspace-list-window";
import {
  listRowsContainer,
  readListScrollPosition,
} from "@/workspace-list/src/use-workspace-list-scroll";

/** Marks the spacer elements among the rows, so measuring can skip them. */
export const WORKSPACE_LIST_SPACER_ATTR = "data-workspace-list-spacer";

/**
 * Rounding in `offsetTop` moves a row's pitch by a pixel when the rows above it
 * shift. Smaller changes than this are not news, or measuring would never settle.
 */
const MIN_SIZE_CHANGE_PX = 1.5;

function supportsScrollAnchoring(): boolean {
  return typeof CSS !== "undefined" && CSS.supports?.("overflow-anchor", "auto") === true;
}

type Measured = { size: number; estimate: number };

/**
 * Row sizes for the window: measured once a row has been mounted, estimated before.
 * Estimates are scaled by how measured rows compared with their own estimates, so a
 * root font size or a denser layout corrects the rows not seen yet as well.
 */
export function useWorkspaceListRowSizes(
  keys: readonly string[],
  estimates: readonly number[],
  enabled: boolean,
) {
  const measuredRef = useRef(new Map<string, Measured>());
  const [version, setVersion] = useState(0);
  const offsets = useMemo(() => {
    if (!enabled) return listRowOffsets(new Float64Array(keys.length));
    let measuredSum = 0;
    let estimateSum = 0;
    for (const entry of measuredRef.current.values()) {
      measuredSum += entry.size;
      estimateSum += entry.estimate;
    }
    const scale = measuredSum > 0 && estimateSum > 0 ? measuredSum / estimateSum : 1;
    const sizes = new Float64Array(keys.length);
    for (let index = 0; index < keys.length; index += 1) {
      sizes[index] = measuredRef.current.get(keys[index]!)?.size ?? estimates[index]! * scale;
    }
    return listRowOffsets(sizes);
    // `version` is the signal that measuredRef changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, estimates, keys, version]);
  const bump = useCallback(() => setVersion((value) => value + 1), []);
  return { offsets, measuredRef, bump };
}

type MeasureArgs = {
  listNode: HTMLElement | null;
  scroller: HTMLElement | null;
  enabled: boolean;
  /** Item indexes of the mounted rows, in DOM order. */
  renderedIndexes: readonly number[];
  keys: readonly string[];
  estimates: readonly number[];
  offsets: Float64Array;
  measuredRef: { current: Map<string, Measured> };
  bump: () => void;
};

/**
 * Measures every mounted row after each commit and when one resizes. A row's size
 * is its pitch: from its top to the next element's top, so the gap under it counts.
 * `offsetTop` ignores the FLIP transforms of a running reorder animation.
 */
export function useMeasureMountedRows({
  listNode,
  scroller,
  enabled,
  renderedIndexes,
  keys,
  estimates,
  offsets,
  measuredRef,
  bump,
}: MeasureArgs) {
  const latest = useRef({ renderedIndexes, keys, estimates, offsets, scroller });
  latest.current = { renderedIndexes, keys, estimates, offsets, scroller };

  const measure = useCallback(() => {
    const container = listRowsContainer(listNode);
    if (!container) return;
    const { renderedIndexes, keys, estimates, offsets, scroller } = latest.current;
    const rows = Array.from(container.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute(WORKSPACE_LIST_SPACER_ATTR),
    );
    // A binding that renders more than one root element per row cannot be measured.
    if (rows.length !== renderedIndexes.length) return;
    const viewTop = scroller ? readListScrollPosition(scroller, container).top : 0;
    let changed = false;
    let shiftAbove = 0;
    rows.forEach((row, position) => {
      const index = renderedIndexes[position]!;
      const key = keys[index]!;
      const next = row.nextElementSibling as HTMLElement | null;
      const size = next ? next.offsetTop - row.offsetTop : row.offsetHeight;
      if (size <= 0) return;
      const known = measuredRef.current.get(key);
      const current = offsets[index + 1]! - offsets[index]!;
      if (known && Math.abs(known.size - size) < MIN_SIZE_CHANGE_PX) return;
      measuredRef.current.set(key, { size, estimate: estimates[index]! });
      if (Math.abs(current - size) < MIN_SIZE_CHANGE_PX) return;
      changed = true;
      if (offsets[index + 1]! <= viewTop) shiftAbove += size - current;
    });
    if (!changed) return;
    // Chrome and Firefox anchor the scroll position themselves; Safari does not.
    if (scroller && shiftAbove !== 0 && !supportsScrollAnchoring())
      scroller.scrollTop += shiftAbove;
    bump();
  }, [bump, listNode, measuredRef]);

  useLayoutEffect(() => {
    if (enabled) measure();
  });

  const renderedKey = renderedIndexes.join(",");
  useLayoutEffect(() => {
    if (!enabled || typeof ResizeObserver === "undefined") return;
    const container = listRowsContainer(listNode);
    if (!container) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    for (const child of Array.from(container.children)) observer.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [enabled, listNode, measure, renderedKey]);
}
