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

/**
 * FLIP-animates `[data-list-item-id]` rows when their DOM order changes.
 * No-op when order is unchanged, `prefers-reduced-motion` is set, or the change
 * is a pure removal/insertion (swipe-archive already animates the row out —
 * FLIP would briefly translate siblings back and cause a jump).
 */
export function useListReorderAnimation(
  containerRef: RefObject<HTMLElement | null>,
  itemIds: readonly string[],
  options?: { durationMs?: number; disabled?: boolean },
) {
  const prevRectsRef = useRef(new Map<string, number>());
  const prevIdsRef = useRef<readonly string[]>([]);
  const prevOrderKeyRef = useRef("");
  const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
  const disabled = options?.disabled ?? false;
  const orderKey = itemIds.join("\0");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const nodes = readItemNodes(container);
    const nextTops = new Map<string, number>();
    for (const node of nodes) {
      const id = node.getAttribute("data-list-item-id");
      if (!id) continue;
      nextTops.set(id, animationTarget(node).getBoundingClientRect().top);
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

    if (skipAnimate) {
      prevRectsRef.current = nextTops;
      return;
    }

    const prevTops = prevRectsRef.current;
    const cleanupFns: Array<() => void> = [];

    for (const node of nodes) {
      const id = node.getAttribute("data-list-item-id");
      if (!id) continue;
      const firstTop = prevTops.get(id);
      const lastTop = nextTops.get(id);
      if (firstTop === undefined || lastTop === undefined) continue;
      const dy = firstTop - lastTop;
      if (Math.abs(dy) < MIN_DELTA_PX) continue;

      const target = animationTarget(node);
      target.style.transition = "none";
      target.style.transform = `translateY(${dy}px)`;
      void target.offsetHeight;
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

    prevRectsRef.current = nextTops;
    return () => {
      for (const cleanup of cleanupFns) cleanup();
    };
    // `orderKey` captures id identity/order; omit `itemIds` so new array refs
    // from `.map()` do not re-run this every parent render.
  }, [containerRef, disabled, durationMs, orderKey]);
}
