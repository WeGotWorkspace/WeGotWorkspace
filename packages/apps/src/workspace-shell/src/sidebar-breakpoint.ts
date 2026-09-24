/**
 * Left app-sidebar dock threshold — keep in sync with `--breakpoint-sidebar` in styles.css.
 * Below this width the sidebar is an overlay drawer; at/above it docks in the layout.
 * Do not reuse for list/detail mobile split (that stays at Tailwind `md` / 768px).
 *
 * Prefer the rem media query so JS matches Tailwind `sidebar:` when root font-size ≠ 16px.
 * `SIDEBAR_DOCKED_MIN_PX` is the 16px-root equivalent for tests and docs only.
 */
export const SIDEBAR_DOCKED_MIN = "72.5rem";
export const SIDEBAR_DOCKED_MIN_PX = 1160;

/** `matchMedia` query when the sidebar should behave as an overlay (matches `sidebar:` dock). */
export const SIDEBAR_OVERLAY_MEDIA_QUERY = `(max-width: calc(${SIDEBAR_DOCKED_MIN} - 1px))`;

export function isSidebarOverlayViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY).matches;
}
