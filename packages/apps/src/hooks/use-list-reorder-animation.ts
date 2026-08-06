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
 * FLIP-animates `[data-list-item-id]` rows when their DOM order changes.
 * No-op when order is unchanged or `prefers-reduced-motion` is set.
 */
export function useListReorderAnimation(
  containerRef: RefObject<HTMLElement | null>,
  itemIds: readonly string[],
  options?: { durationMs?: number; disabled?: boolean },
) {
  const prevRectsRef = useRef(new Map<string, number>());
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

    const orderChanged = orderKey !== prevOrderKeyRef.current;
    const skipAnimate =
      disabled || !orderChanged || prevOrderKeyRef.current === "" || prefersReducedMotion();
    prevOrderKeyRef.current = orderKey;

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
  }, [containerRef, disabled, durationMs, orderKey]);
}
