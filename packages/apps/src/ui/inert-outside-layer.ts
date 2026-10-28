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
 *
 * The outside is snapshotted once per layer node. Radix composes the content
 * ref anew on every render, so React detaches (`null`) and re-attaches the same
 * node each commit; walking again then would make a popover opened from inside
 * the layer inert (#1699). The release waits a microtask, and a re-attach of the
 * same node in the meantime keeps the first snapshot.
 */
export function useInertOutsideLayerRef<T extends Element>(
  forwardedRef: React.ForwardedRef<T>,
): React.RefCallback<T> {
  const attached = React.useRef<{ node: T; release: () => void } | null>(null);
  const pendingDetach = React.useRef(0);

  return React.useCallback(
    (node: T | null) => {
      if (node) {
        pendingDetach.current += 1; // Cancels a release scheduled by a detach.
        if (attached.current?.node !== node) {
          attached.current?.release();
          attached.current = { node, release: inertOutsideLayer(node) };
        }
      } else if (attached.current) {
        const ticket = ++pendingDetach.current;
        queueMicrotask(() => {
          if (pendingDetach.current !== ticket) return;
          attached.current?.release();
          attached.current = null;
        });
      }
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );
}
