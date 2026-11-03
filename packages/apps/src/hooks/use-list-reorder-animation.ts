import { useLayoutEffect, useRef, type RefObject } from "react";

const DEFAULT_DURATION_MS = 280;
const DEFAULT_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const MIN_DELTA_PX = 1;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readItemNodes(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-list-item-id]"));
}

function animationTarget(node: HTMLElement): HTMLElement {
  const swipeParent = node.parentElement;
  if (swipeParent?.classList.contains("swipeable-list-item")) return swipeParent;
  return node;
}

/**
 * True when `nextIds` keeps the relative order of items shared with `prevIds`
 * (pure insert and/or delete — not a reorder).
 */
export function isListRelativeOrderPreserved(
  prevIds: readonly string[],
  nextIds: readonly string[],
): boolean {
  if (nextIds.length === 0) return true;
  let i = 0;
  for (const id of prevIds) {
    if (id === nextIds[i]) i += 1;
    if (i === nextIds.length) return true;
  }
  return i === nextIds.length;
}

type RowBox = { top: number; height: number };

function isInViewport(viewportTop: number, height: number): boolean {
  return viewportTop + height > 0 && viewportTop < window.innerHeight;
}

/**
 * FLIP-animates `[data-list-item-id]` rows when their DOM order changes.
 * No-op when order is unchanged, `prefers-reduced-motion` is set, or the change
 * is a pure removal/insertion (swipe-archive already animates the row out —
 * FLIP would briefly translate siblings back and cause a jump).
 *
 * Row positions are stored relative to the list, so scrolling between two
 * reorders does not make every row look moved. Only rows on screen before or
 * after the change animate, and all transforms are written before one reflow
 * (not one reflow per row): a long list stays cheap to reorder (#1714).
 */
export function useListReorderAnimation(
  containerRef: RefObject<HTMLElement | null>,
  itemIds: readonly string[],
  options?: { durationMs?: number; disabled?: boolean },
) {
  const prevBoxesRef = useRef(new Map<string, RowBox>());
  const prevIdsRef = useRef<readonly string[]>([]);
  const prevOrderKeyRef = useRef("");
  const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
  const disabled = options?.disabled ?? false;
  const orderKey = itemIds.join("\0");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerTop = container.getBoundingClientRect().top;
    const nodes = readItemNodes(container);
    const nextBoxes = new Map<string, RowBox>();
    for (const node of nodes) {
      const id = node.getAttribute("data-list-item-id");
      if (!id) continue;
      const rect = animationTarget(node).getBoundingClientRect();
      nextBoxes.set(id, { top: rect.top - containerTop, height: rect.height });
    }

    const prevIds = prevIdsRef.current;
    const nextIds = orderKey.length === 0 ? [] : orderKey.split("\0");
    const orderChanged = orderKey !== prevOrderKeyRef.current;
    // Swipe destructive remove already collapsed the row; FLIP on pure removals
    // reapplies the gap for one frame (jump). Same for pure inserts.
    const pureStructuralChange =
      orderChanged &&
      prevIds.length > 0 &&
      (isListRelativeOrderPreserved(prevIds, nextIds) ||
        isListRelativeOrderPreserved(nextIds, prevIds));
    const skipAnimate =
      disabled ||
      !orderChanged ||
      prevOrderKeyRef.current === "" ||
      prefersReducedMotion() ||
      pureStructuralChange;
    prevOrderKeyRef.current = orderKey;
    prevIdsRef.current = nextIds;

    const prevBoxes = prevBoxesRef.current;
    prevBoxesRef.current = nextBoxes;
    if (skipAnimate) return;

    const moves: { target: HTMLElement; dy: number }[] = [];
    for (const node of nodes) {
      const id = node.getAttribute("data-list-item-id");
      if (!id) continue;
      const first = prevBoxes.get(id);
      const last = nextBoxes.get(id);
      if (first === undefined || last === undefined) continue;
      const dy = first.top - last.top;
      if (Math.abs(dy) < MIN_DELTA_PX) continue;
      const onScreen =
        isInViewport(containerTop + first.top, first.height) ||
        isInViewport(containerTop + last.top, last.height);
      if (!onScreen) continue;
      moves.push({ target: animationTarget(node), dy });
    }
    if (moves.length === 0) return;

    for (const { target, dy } of moves) {
      target.style.transition = "none";
      target.style.transform = `translateY(${dy}px)`;
    }
    // One reflow commits every start position before the transitions begin.
    void container.offsetHeight;

    const cleanupFns: Array<() => void> = [];
    for (const { target } of moves) {
      target.style.transition = `transform ${durationMs}ms ${DEFAULT_EASING}`;
      target.style.transform = "";

      const onEnd = (event: TransitionEvent) => {
        if (event.target !== target || event.propertyName !== "transform") return;
        target.style.transition = "";
        target.style.transform = "";
        target.removeEventListener("transitionend", onEnd);
      };
      target.addEventListener("transitionend", onEnd);
      cleanupFns.push(() => {
        target.removeEventListener("transitionend", onEnd);
      });
    }

    return () => {
      for (const cleanup of cleanupFns) cleanup();
    };
    // `orderKey` captures id identity/order; omit `itemIds` so new array refs
    // from `.map()` do not re-run this every parent render.
  }, [containerRef, disabled, durationMs, orderKey]);
}
