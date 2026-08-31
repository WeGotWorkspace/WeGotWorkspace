import { isLocalTempNoteId } from "@/lib/offline/notes-offline-store";

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
 * A `local-*` 404 is a create race, not a deleted object.
 */
export function isNotesPersistGone(error: unknown, noteId?: string): boolean {
  if (persistHttpStatus(error) !== 404) return false;
  if (noteId && isLocalTempNoteId(noteId)) return false;
  return true;
}

/** 412 / local-* 404 are create or etag races — keep the optimistic row. */
export function isNotesMetadataSyncRace(error: unknown, noteId: string): boolean {
  const status = persistHttpStatus(error);
  if (status === 412) return true;
  return status === 404 && isLocalTempNoteId(noteId);
}

/** Run a note write; on 404 drop the local ghost and resolve instead of retrying. */
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

/**
 * Metadata upsert (tags/title/notebook). 412 and local-* 404 are create/etag
 * races — keep the optimistic row instead of failing the write queue.
 */
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
