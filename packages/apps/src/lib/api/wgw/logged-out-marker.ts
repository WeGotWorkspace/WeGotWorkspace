export const LOGGED_OUT_MARKER_KEY = "wgw.api.logged_out";

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readLoggedOutMarker(): boolean {
  if (!hasWindowStorage()) return false;
  try {
    return window.localStorage.getItem(LOGGED_OUT_MARKER_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLoggedOutMarker(value: boolean): void {
  if (!hasWindowStorage()) return;
  try {
    if (value) {
      window.localStorage.setItem(LOGGED_OUT_MARKER_KEY, "1");
    } else {
      window.localStorage.removeItem(LOGGED_OUT_MARKER_KEY);
    }
  } catch {
    // Ignore storage failures and keep in-memory fallback.
  }
}
