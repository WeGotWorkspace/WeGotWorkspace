import { isLocalTempNoteId } from "@/lib/offline/notes-offline-store";

export const NOTES_ACCESS_LOST_MESSAGE =
  "You no longer have access to this note. Unsaved edits were not stored.";

export function persistHttpStatus(error: unknown): number | undefined {
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
 * Real-UID 404: the object is gone — drop Dexie so it cannot linger as a
 * zombie. `local-*` 404 is a create race, not gone. Auth / 412 / 5xx stay.
 */
export function isNotesPersistGone(error: unknown, noteId?: string): boolean {
  if (persistHttpStatus(error) !== 404) return false;
  if (noteId && isLocalTempNoteId(noteId)) return false;
  return true;
}

/** 412 or local-* 404: keep the optimistic metadata row. */
export function isNotesMetadataSyncRace(error: unknown, noteId: string): boolean {
  const status = persistHttpStatus(error);
  if (status === 412) return true;
  return status === 404 && isLocalTempNoteId(noteId);
}

/** Drop the local ghost on a real-UID 404; rethrow anything else. */
export async function persistNoteOrDropGone<T>(
  write: Promise<T>,
  onGone: () => void,
  noteId?: string,
): Promise<T | undefined> {
  try {
    return await write;
  } catch (error) {
    if (isNotesPersistGone(error, noteId)) {
      onGone();
      return undefined;
    }
    throw error;
  }
}

/** Metadata upsert: also swallow 412 / local-* 404 so the write queue stays up. */
export async function persistNoteKeepingSyncRace<T>(
  write: Promise<T>,
  onGone: () => void,
  noteId: string,
): Promise<T | undefined> {
  try {
    return await persistNoteOrDropGone(write, onGone, noteId);
  } catch (error) {
    if (isNotesMetadataSyncRace(error, noteId)) return undefined;
    throw error;
  }
}

export type NotesPersistAccessDecision = "leave-room" | "continue";

/** On persist 403 the client leaves the mesh and stops sending updates. */
export function resolveNotesPersistAccess(error: unknown): NotesPersistAccessDecision {
  return isNotesPersistForbidden(error) ? "leave-room" : "continue";
}
