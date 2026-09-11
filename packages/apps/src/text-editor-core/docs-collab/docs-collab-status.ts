export const TRANSIENT_DOC_STATUS_DISMISS_MS = 4000;

export const DOC_STATUS_LOADED_SHARED_DOCUMENT = "Loaded shared document";
export const DOC_STATUS_RESTORED_WORKING_VERSION = "Restored working version";
export const DOC_STATUS_NOTE_TOO_LARGE = "This note is too large to save.";

const TRANSIENT_DOC_STATUS_MESSAGES = new Set<string>([
  DOC_STATUS_LOADED_SHARED_DOCUMENT,
  DOC_STATUS_RESTORED_WORKING_VERSION,
]);

/**
 * Transient statuses are one-off confirmations safe to auto-dismiss. Everything
 * else (connection/sync state, errors) is persistent and must stay until the
 * state itself changes.
 */
export function isTransientDocStatus(status: string): boolean {
  if (!status) return false;
  return TRANSIENT_DOC_STATUS_MESSAGES.has(status);
}

/** Save/persist failures that should toast, not stick in footer chrome. */
export function isSaveFailureDocStatus(status: string): boolean {
  if (!status) return false;
  return status.startsWith("Save failed:") || status === DOC_STATUS_NOTE_TOO_LARGE;
}

/**
 * Ephemeral messages shown via toast (not footer `end` / DocsDocStatus).
 * Connection states (offline, reconnecting, …) stay eligible for chrome.
 */
export function isToastDocStatus(status: string): boolean {
  return isTransientDocStatus(status) || isSaveFailureDocStatus(status);
}
