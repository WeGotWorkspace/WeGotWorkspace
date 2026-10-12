/** Same key and value as `setLoggedOutMarker` in the API session module. */
const LOGGED_OUT_MARKER_KEY = "wgw.api.logged_out";

function offlineUsernameKey(domain: string): string {
  return `wgw.offline.${domain}.username`;
}

function readLoggedOutMarker(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOGGED_OUT_MARKER_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the last known username for a domain so its cache can be found while offline. */
export function rememberOfflineUsername(domain: string, username: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(offlineUsernameKey(domain), username);
  } catch {
    // ignore
  }
}

export function readOfflineUsername(domain: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(offlineUsernameKey(domain));
  } catch {
    return null;
  }
}

/**
 * Session username first. The remembered account is used only when this device
 * has not been explicitly logged out, so a shared computer cannot reopen the
 * previous user's cache after sign-out.
 */
export function resolveOfflineUsername(
  domain: string,
  sessionUsername: string | undefined,
): string | null {
  const fromSession = sessionUsername?.trim();
  if (fromSession) return fromSession;
  if (readLoggedOutMarker()) return null;
  return readOfflineUsername(domain)?.trim() ?? null;
}
