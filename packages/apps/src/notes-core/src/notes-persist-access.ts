export const NOTES_ACCESS_LOST_MESSAGE =
  "You no longer have access to this note. Unsaved edits were not stored.";

export function isNotesPersistForbidden(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 403) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\(403\)/.test(message);
}

export type NotesPersistAccessDecision = "leave-room" | "continue";

/** On persist 403 the client leaves the mesh and stops sending updates. */
export function resolveNotesPersistAccess(error: unknown): NotesPersistAccessDecision {
  return isNotesPersistForbidden(error) ? "leave-room" : "continue";
}
