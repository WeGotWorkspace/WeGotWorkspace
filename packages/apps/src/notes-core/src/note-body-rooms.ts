/**
 * Notes whose body a live collab room in this tab holds. A push sync fetches
 * those without `body`: the room already has it and keeps the cached preview
 * current (docs/architecture/jmap-push.md, "Collab rooms lead").
 */
const open = new Map<string, number>();

/** Mark the note's room as open; call the result when it closes. */
export function holdNoteBodyRoom(noteId: string): () => void {
  open.set(noteId, (open.get(noteId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (open.get(noteId) ?? 1) - 1;
    if (count > 0) open.set(noteId, count);
    else open.delete(noteId);
  };
}

export function noteBodyInRoom(noteId: string): boolean {
  return open.has(noteId);
}
