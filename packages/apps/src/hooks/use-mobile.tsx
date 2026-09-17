import * as React from "react";

/**
 * Tailwind `md` (768px). Mobile is strictly below this so portrait iPad (768px)
 * is not treated as mobile — keep in sync with `(max-width: 767px)` / `max-md`.
 */
export const MOBILE_BREAKPOINT_PX = 768;

/** `matchMedia` query for viewports that should use mobile chrome (dialog, sheet, …). */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

function getSnapshot() {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

/**
 * True when the CSS viewport matches {@link MOBILE_MEDIA_QUERY}.
 * Reads `matchMedia().matches` (not `innerWidth`) so iOS Safari
 * visual/layout viewport mismatches cannot keep desktop Popover chrome.
 * `useSyncExternalStore` exposes the client snapshot on first paint.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
