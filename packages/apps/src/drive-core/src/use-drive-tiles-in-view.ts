import { useEffect, type RefObject } from "react";

/** Attribute on each Drive grid file tile; its value is the file id. */
export const DRIVE_FILE_TILE_ID_ATTRIBUTE = "data-drive-file-id";

/** Tiles this far below or above the scrollport count as on screen (previews load ahead). */
export const DRIVE_TILES_IN_VIEW_MARGIN = "400px 0px";

/**
 * Reports the ids of the grid file tiles on (or near) screen in `rootRef`, so
 * previews load only for those. Tiles that appear later (a re-render, a
 * folder change) are picked up through a MutationObserver.
 *
 * Without IntersectionObserver (old browser, test DOM) it reports `null`:
 * "visibility unknown", and the caller loads every preview as before.
 */
export function useDriveTilesInView(
  rootRef: RefObject<HTMLElement | null>,
  onChange: (ids: ReadonlySet<string> | null) => void,
  enabled = true,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    if (typeof IntersectionObserver === "undefined") {
      onChange(null);
      return;
    }

    const inView = new Set<string>();
    const observed = new WeakSet<Element>();
    const report = () => onChange(new Set(inView));

    const intersections = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = entry.target.getAttribute(DRIVE_FILE_TILE_ID_ATTRIBUTE);
          if (!id) continue;
          if (entry.isIntersecting && !inView.has(id)) {
            inView.add(id);
            changed = true;
          } else if (!entry.isIntersecting && inView.delete(id)) {
            changed = true;
          }
        }
        if (changed) report();
      },
      { root, rootMargin: DRIVE_TILES_IN_VIEW_MARGIN },
    );

    const observeTiles = () => {
      for (const tile of root.querySelectorAll(`[${DRIVE_FILE_TILE_ID_ATTRIBUTE}]`)) {
        if (observed.has(tile)) continue;
        observed.add(tile);
        intersections.observe(tile);
      }
    };
    const mutations = new MutationObserver(observeTiles);
    mutations.observe(root, { childList: true, subtree: true });
    observeTiles();
    report();

    return () => {
      mutations.disconnect();
      intersections.disconnect();
    };
  }, [enabled, onChange, rootRef]);
}
