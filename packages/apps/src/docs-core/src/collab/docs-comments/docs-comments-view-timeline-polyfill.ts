/**
 * Lazy loader for scroll-driven animation support in docs comment cards.
 *
 * Uses `scroll-timeline-polyfill` (flackr/scroll-timeline on GitHub / npm) when the
 * host lacks native `animation-timeline: view()`. Chosen because it is the spec-aligned
 * reference polyfill with ViewTimeline + CSS entry/exit keyframes, zero runtime deps,
 * WPT coverage (including Firefox), and ~60 KB minified. Alternatives are either the
 * same package under another name or absent for view-timeline CSS.
 *
 * The polyfill only reads timeline rules from stylesheets (not inline styles), so mark
 * and card timelines are injected via `syncCommentViewTimelineStyles`.
 */

let polyfillLoad: Promise<boolean> | null = null;

export function supportsNativeCommentViewTimeline(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  return CSS.supports("animation-timeline", "view()");
}

/** True when native or polyfilled scroll-driven animations are available. */
export function supportsCommentViewTimeline(): boolean {
  if (supportsNativeCommentViewTimeline()) return true;
  if ("ViewTimeline" in globalThis) return true;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports("animation-timeline: view()");
  }
  return false;
}

export function usesCommentViewTimelinePolyfill(): boolean {
  return supportsCommentViewTimeline() && !supportsNativeCommentViewTimeline();
}

/** Load the polyfill once; resolves false when import fails or support stays unavailable. */
export function ensureCommentViewTimelinePolyfill(): Promise<boolean> {
  if (supportsCommentViewTimeline()) return Promise.resolve(true);
  if (polyfillLoad) return polyfillLoad;

  polyfillLoad = import("scroll-timeline-polyfill/dist/scroll-timeline.js")
    .then(() => supportsCommentViewTimeline())
    .catch(() => false);

  return polyfillLoad;
}
