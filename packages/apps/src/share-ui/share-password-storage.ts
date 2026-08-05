const STORAGE_PREFIX = "wgw:share-public-password:";

export function sharePasswordStorageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope}`;
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
    if (password.trim()) {
      sessionStorage.setItem(sharePasswordStorageKey(scope), password);
      return;
    }
    sessionStorage.removeItem(sharePasswordStorageKey(scope));
  } catch {
    // Ignore quota / privacy mode errors.
  }
}

export function clearStoredSharePassword(scope: string | undefined): void {
  if (!scope) return;
  writeStoredSharePassword(scope, "");
}
