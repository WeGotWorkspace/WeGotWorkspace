import { useSyncExternalStore } from "react";

/**
 * When the app rail shows: the sidebar is docked and the viewport is landscape.
 * Keep in sync with the media query in `app-rail.css`.
 */
export const APP_RAIL_MEDIA_QUERY = "(min-width: 72.5rem) and (orientation: landscape)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(APP_RAIL_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(APP_RAIL_MEDIA_QUERY).matches;
}

/** True while the app rail is on screen. For choices CSS cannot make (where one live control mounts). */
export function useAppRailVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
