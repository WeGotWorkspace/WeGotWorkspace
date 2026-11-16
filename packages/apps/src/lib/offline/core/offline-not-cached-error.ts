/**
 * An app opened offline before its first online visit on this device: there
 * is nothing cached to show yet (#2100). Not a load failure; the app works
 * once it has been opened online.
 */
export class OfflineNotCachedError extends Error {
  constructor(what: string) {
    super(`No cached ${what} available offline`);
    this.name = "OfflineNotCachedError";
  }
}

export function isOfflineNotCachedError(error: unknown): error is OfflineNotCachedError {
  return error instanceof OfflineNotCachedError;
}
