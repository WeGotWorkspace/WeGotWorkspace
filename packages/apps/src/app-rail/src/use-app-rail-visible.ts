import { useSyncExternalStore } from "react";

/**
 * When the app rail is docked in the layout (the sidebar's dock width). Below it
 * the rail is the leading strip of the sidebar drawer. Keep in sync with
 * `app-rail.css` and `--breakpoint-sidebar`.
 */
export const APP_RAIL_MEDIA_QUERY = "(min-width: 72.5rem)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(APP_RAIL_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(APP_RAIL_MEDIA_QUERY).matches;
}

/** True while the app rail is docked (not in the drawer). For choices CSS cannot make. */
export function useAppRailVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
