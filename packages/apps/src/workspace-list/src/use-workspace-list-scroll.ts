import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { listWindowRange, type ListWindowRange } from "@/workspace-list/src/workspace-list-window";

/** The nearest ancestor that scrolls vertically, or null (then nothing is windowed). */
export function findListScroller(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * The element whose children are the rows (and spacers): the swipe list (its
 * `SwipeableList` on touch) for `WorkspaceList`, else the list node itself (a
 * table body, a grid).
 */
export function listRowsContainer(listNode: HTMLElement | null): HTMLElement | null {
  const outer = listNode?.querySelector<HTMLElement>(":scope > .workspace-swipe-list") ?? null;
  if (!outer) return listNode;
  return outer.querySelector<HTMLElement>(":scope > .swipeable-list") ?? outer;
}

export type ListScrollPosition = {
  /** Scroll offset measured from the top of the rows, not of the scroller. */
  top: number;
  viewportHeight: number;
};

/** Where the rows are scrolled to, read fresh from the DOM. */
export function readListScrollPosition(
  scroller: HTMLElement,
  rows: HTMLElement | null,
): ListScrollPosition {
  const rowsTop = rows
    ? rows.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    : 0;
  return { top: scroller.scrollTop - rowsTop, viewportHeight: scroller.clientHeight };
}

function sameRange(a: ListWindowRange, b: ListWindowRange): boolean {
  return a.start === b.start && a.end === b.end;
}

/**
 * The window of rows to mount for the list's scroller. Re-renders only when the
 * range changes, not on every scroll event.
 */
export function useWorkspaceListScroll(
  listNode: HTMLElement | null,
  offsets: Float64Array,
  enabled: boolean,
) {
  const count = offsets.length - 1;
  // `undefined` until the list has looked for its scroller: render a first window
  // then, not every row. `null` means there is none (a story, a test): no window.
  const [scroller, setScroller] = useState<HTMLElement | null | undefined>(undefined);
  const [range, setRange] = useState<ListWindowRange>(() => listWindowRange(offsets, 0, 0));
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;

  const update = useCallback(() => {
    if (!scroller || !listNode) return;
    const position = readListScrollPosition(scroller, listRowsContainer(listNode));
    const next = listWindowRange(offsetsRef.current, position.top, position.viewportHeight);
    setRange((previous) => (sameRange(previous, next) ? previous : next));
  }, [listNode, scroller]);

  useLayoutEffect(() => {
    if (!enabled) setScroller(null);
    else if (listNode) setScroller(findListScroller(listNode));
    else setScroller(undefined);
  }, [enabled, listNode]);

  useLayoutEffect(() => {
    if (!scroller) return;
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [scroller, update]);

  // New items or new row sizes move the window too, not only scrolling.
  useLayoutEffect(() => {
    update();
  }, [offsets, update]);

  if (!enabled || scroller === null) return { scroller: null, range: { start: 0, end: count } };
  // Items can shrink before the effect above runs again.
  return {
    scroller: scroller ?? null,
    range: { start: Math.min(range.start, count), end: Math.min(range.end, count) },
  };
}
