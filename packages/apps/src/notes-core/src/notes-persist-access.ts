import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";

export const NOTES_ACCESS_LOST_MESSAGE =
  "You no longer have access to this note. Unsaved edits were not stored.";

export function persistHttpStatus(error: unknown): number | undefined {
  const status = httpStatusFromFlushError(error);
  if (typeof status === "number") return status;
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
 * 404: the object is gone — drop Dexie so it cannot linger as a zombie. A
 * note not on the server yet is never written directly (its create waits in
 * the outbox), so a 404 is never a create race. Auth / 412 / 5xx stay.
 */
export function isNotesPersistGone(error: unknown): boolean {
  return persistHttpStatus(error) === 404;
}

/** Drop the local ghost on a real-UID 404; rethrow anything else. */
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

/** Metadata upsert: also swallow a 412 so the write queue stays up. */
export async function persistNoteKeepingSyncRace<T>(
  write: Promise<T>,
  onGone: () => void,
  noteId: string,
): Promise<T | undefined> {
  try {
    return await persistNoteOrDropGone(write, onGone);
  } catch (error) {
    if (persistHttpStatus(error) === 412) {
      console.warn(`[notes] metadata update lost a 412 sync race for note ${noteId}`);
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
