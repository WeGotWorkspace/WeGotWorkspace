import * as React from "react";

/** How many open layers made each element inert; nested modals share siblings. */
const inertCounts = new WeakMap<Element, number>();

function addInert(element: Element): boolean {
  const count = inertCounts.get(element) ?? 0;
  // Already inert for another reason (e.g. a parked surface): leave it alone.
  if (count === 0 && element.hasAttribute("inert")) return false;
  inertCounts.set(element, count + 1);
  element.setAttribute("inert", "");
  return true;
}

function releaseInert(element: Element) {
  const count = (inertCounts.get(element) ?? 1) - 1;
  if (count > 0) {
    inertCounts.set(element, count);
    return;
  }
  inertCounts.delete(element);
  element.removeAttribute("inert");
}

/**
 * Radix modal layers mark everything outside them `aria-hidden` but leave it
 * focusable (axe `aria-hidden-focus`). Make the same elements inert, like a
 * native modal dialog: everything except the layer, live regions and scripts.
 * Returns the cleanup.
 */
export function inertOutsideLayer(layer: Element): () => void {
  const body = layer.ownerDocument.body;
  const keep = new Set<Element>([layer, ...body.querySelectorAll("[aria-live], script")]);
  const keepAncestors = new Set<Element>();
  for (const element of keep) {
    for (let node = element.parentElement; node && node !== body; node = node.parentElement) {
      keepAncestors.add(node);
    }
  }

  const owned: Element[] = [];
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (keep.has(child)) continue;
      if (keepAncestors.has(child)) walk(child);
      else if (addInert(child)) owned.push(child);
    }
  };
  walk(body);

  return () => owned.forEach(releaseInert);
}

/**
 * Callback ref for modal Radix content. Portaled content mounts a commit after
 * its wrapper, so this runs on attach rather than in the wrapper's effect.
 */
export function useInertOutsideLayerRef<T extends Element>(
  forwardedRef: React.ForwardedRef<T>,
): React.RefCallback<T> {
  const releaseRef = React.useRef<(() => void) | null>(null);

  return React.useCallback(
    (node: T | null) => {
      releaseRef.current?.();
      releaseRef.current = null;
      if (node) releaseRef.current = inertOutsideLayer(node);
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );
}
