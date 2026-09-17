/**
 * Tailwind `md` minus 1 — keep in sync with `@media (min-width: 48rem)` in
 * workspace-app.css. Below this width the collection detail pane is a full-screen overlay.
 * Do not reuse {@link SIDEBAR_DOCKED_MIN_PX} (sidebar overlay is wider).
 */
export const COLLECTION_DETAIL_OVERLAY_MAX_PX = 767;

/** `matchMedia` query when list/detail should use the mobile overlay + view transition. */
export const COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY = `(max-width: ${COLLECTION_DETAIL_OVERLAY_MAX_PX}px)`;

export function isCollectionDetailOverlayViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY).matches
  );
}
