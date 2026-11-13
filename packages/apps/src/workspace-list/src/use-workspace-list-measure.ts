import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listRowOffsets } from "@/workspace-list/src/workspace-list-window";
import {
  listRowsContainer,
  readListScrollPosition,
} from "@/workspace-list/src/use-workspace-list-scroll";

/** Marks the spacer elements among the rows, so measuring can skip them. */
export const WORKSPACE_LIST_SPACER_ATTR = "data-workspace-list-spacer";
/** Marks a section wrapper (`renderSection`): its children are rows, its first one the header. */
export const WORKSPACE_LIST_SECTION_ATTR = "data-workspace-list-section";

function isSection(element: Element): boolean {
  return element.hasAttribute(WORKSPACE_LIST_SECTION_ATTR);
}

/** Rows and spacers in item order, looking inside section wrappers. */
export function listRowElements(container: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (const child of Array.from(container.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (!isSection(child)) {
      elements.push(child);
      continue;
    }
    for (const row of Array.from(child.children)) {
      if (row instanceof HTMLElement) elements.push(row);
    }
  }
  return elements;
}

function isSpacer(element: Element): boolean {
  return element.hasAttribute(WORKSPACE_LIST_SPACER_ATTR);
}

/**
 * Where an element sits without sticky offsets or transforms. A section's header
 * is sticky, and a stuck element reports where it is stuck: its natural top is
 * its section's top.
 */
function naturalTop(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent || !isSection(parent)) return element.offsetTop;
  if (element === parent.firstElementChild) return parent.offsetTop;
  return element.offsetParent === parent ? parent.offsetTop + element.offsetTop : element.offsetTop;
}

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
 * Measures each row when it mounts and when it resizes. A row's size
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
    const elements = listRowElements(container);
    const rows = elements.filter((element) => !isSpacer(element));
    // A binding that renders more than one root element per row cannot be measured.
    if (rows.length !== renderedIndexes.length) return;
    const viewTop = scroller ? readListScrollPosition(scroller, container).top : 0;
    let changed = false;
    let shiftAbove = 0;
    let position = 0;
    elements.forEach((row, at) => {
      if (isSpacer(row)) return;
      const index = renderedIndexes[position]!;
      position += 1;
      const key = keys[index]!;
      const next = elements[at + 1];
      const size = next ? naturalTop(next) - naturalTop(row) : row.offsetHeight;
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

  // One observer per list. It reports each newly observed row once, after the
  // browser's own layout and before paint, so measuring forces no extra layout in
  // the commit (a note opening in the same frame stays as cheap as without a window).
  const observerRef = useRef<{ observer: ResizeObserver; rows: Set<Element> } | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !listNode || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observerRef.current = { observer, rows: new Set() };
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [enabled, listNode, measure]);

  const renderedKey = renderedIndexes.join(",");
  useLayoutEffect(() => {
    const observed = observerRef.current;
    const container = listRowsContainer(listNode);
    if (!observed || !container) return;
    const rows = new Set<Element>(
      listRowElements(container).filter((element) => !isSpacer(element)),
    );
    for (const row of observed.rows) {
      if (!rows.has(row)) observed.observer.unobserve(row);
    }
    for (const row of rows) {
      if (!observed.rows.has(row)) observed.observer.observe(row);
    }
    observed.rows = rows;
  }, [listNode, renderedKey, enabled, measure]);
}
