import { normalizeApiVirtualPath } from "@/lib/files/api-path";

const STORAGE_PREFIX = "wgw:share-public-password:";

/** Stable sessionStorage scope for a share path (leading slash, no trailing slash). */
export function normalizeSharePasswordScope(scope: string): string {
  return normalizeApiVirtualPath(scope);
}

export function sharePasswordStorageKey(scope: string): string {
  return `${STORAGE_PREFIX}${normalizeSharePasswordScope(scope)}`;
}

export function readStoredSharePassword(scope: string | undefined): string {
  if (!scope || typeof sessionStorage === "undefined") return "";
  try {
    return sessionStorage.getItem(sharePasswordStorageKey(scope)) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredSharePassword(scope: string, password: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const key = sharePasswordStorageKey(scope);
    if (password.trim()) {
      sessionStorage.setItem(key, password);
      return;
    }
    sessionStorage.removeItem(key);
  } catch {
    // Ignore quota / privacy mode errors.
  }
}

export function clearStoredSharePassword(scope: string | undefined): void {
  if (!scope) return;
  writeStoredSharePassword(scope, "");
}
