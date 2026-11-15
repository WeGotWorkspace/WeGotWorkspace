/**
 * The suite's resize motion: a box glides from its old size to its new one (the
 * autosave tag, dialogs). CSS cannot transition `auto` to `auto` when only the
 * content changes (`interpolate-size` covers a changed value, not changed
 * content), so the old and new sizes are measured and the change is animated.
 */

export const SIZE_GLIDE_DURATION_MS = 200;
export const SIZE_GLIDE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

/** Below this the change is noise (subpixel layout), not a resize. */
const MIN_DELTA_PX = 1;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animate `property` from `from` to `to` (px). The box is already laid out at
 * `to`; the animation only paints the way there. Null when there is nothing to
 * animate (no change, reduced motion, no Web Animations).
 */
export function glideSize(
  element: HTMLElement,
  property: "width" | "height",
  from: number,
  to: number,
): Animation | null {
  if (Math.abs(from - to) < MIN_DELTA_PX) return null;
  if (prefersReducedMotion() || typeof element.animate !== "function") return null;
  return element.animate([{ [property]: `${from}px` }, { [property]: `${to}px` }], {
    duration: SIZE_GLIDE_DURATION_MS,
    easing: SIZE_GLIDE_EASING,
  });
}

/**
 * Glide `element`'s height whenever its content makes it taller or shorter (a
 * dialog showing more rows). The element must clip its overflow. Returns the
 * cleanup.
 */
export function glideHeightOnResize(element: HTMLElement): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};

  // `offsetHeight`: layout size, untouched by the open/close zoom transform.
  let settled: number | null = null;
  let running: Animation | null = null;

  const glide = (from: number, to: number) => {
    running = glideSize(element, "height", from, to);
    settled = to;
    if (!running) return;
    const animation = running;
    animation.finished
      .catch(() => {})
      .then(() => {
        if (running !== animation) return;
        running = null;
        // The content changed again mid-glide: carry on to where it is now.
        const now = element.offsetHeight;
        if (Math.abs(now - to) >= MIN_DELTA_PX) glide(to, now);
      });
  };

  const observer = new ResizeObserver(() => {
    // The glide's own frames resize the box too; the end of the glide re-measures.
    if (running) return;
    const next = element.offsetHeight;
    if (settled === null) {
      settled = next;
      return;
    }
    glide(settled, next);
  });
  observer.observe(element);

  return () => {
    observer.disconnect();
    running?.cancel();
    running = null;
  };
}
