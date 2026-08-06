/**
 * Left app-sidebar dock threshold — keep in sync with `--breakpoint-sidebar` in styles.css.
 * Below this width the sidebar is an overlay drawer; at/above it docks in the layout.
 * Do not reuse for list/detail mobile split (that stays at Tailwind `md` / 768px).
 */
export const SIDEBAR_DOCKED_MIN_PX = 1160;

/** `matchMedia` query when the sidebar should behave as an overlay. */
export const SIDEBAR_OVERLAY_MEDIA_QUERY = `(max-width: ${SIDEBAR_DOCKED_MIN_PX - 1}px)`;

export function isSidebarOverlayViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY).matches;
}
