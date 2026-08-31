export const NOTES_ACCESS_LOST_MESSAGE =
  "You no longer have access to this note. Unsaved edits were not stored.";

function persistHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /\((\d{3})\)/.exec(message);
  return match ? Number(match[1]) : undefined;
}

export function isNotesPersistForbidden(error: unknown): boolean {
  if (persistHttpStatus(error) === 403) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\(403\)/.test(message);
}

/**
 * 404 means the collection object is gone (or never existed) for this user.
 * Keeping a local-only ghost is worse: it cannot be archived and outbox retries
 * forever. Do not treat 401/403/412/5xx as gone — those are auth, precondition,
 * or transient failures and the Dexie row must stay.
 */
export function isNotesPersistGone(error: unknown): boolean {
  return persistHttpStatus(error) === 404;
}

/** Run a note write; on 404 drop the local ghost and resolve instead of retrying. */
export async function persistNoteOrDropGone<T>(
  write: Promise<T>,
  onGone: () => void,
): Promise<T | undefined> {
  try {
    return await write;
  } catch (error) {
    if (isNotesPersistGone(error)) {
      onGone();
      return undefined;
    }
    throw error;
  }
}

export type NotesPersistAccessDecision = "leave-room" | "continue";

/** On persist 403 the client leaves the mesh and stops sending updates. */
export function resolveNotesPersistAccess(error: unknown): NotesPersistAccessDecision {
  return isNotesPersistForbidden(error) ? "leave-room" : "continue";
}
