import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { Note } from "@/lib/models/note";
import { subscribeNoteCreated } from "@/lib/offline/notes/notes-created-events";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";

/**
 * Clear `createPending` once the queued create reached the server (in this
 * tab or another). The open note's body room then switches from local-only
 * to the server and saves what was typed.
 */
export function useNoteCreated(setNotes: Dispatch<SetStateAction<Note[]>>): void {
  useEffect(
    () =>
      subscribeNoteCreated(({ username, noteId }) => {
        if (username !== readOfflineNotesUsername()) return;
        setNotes((prev) => markNoteCreated(prev, noteId));
      }),
    [setNotes],
  );
}

export function markNoteCreated(notes: Note[], noteId: string): Note[] {
  if (!notes.some((note) => note.id === noteId && note.createPending)) return notes;
  return notes.map((note) => {
    if (note.id !== noteId) return note;
    const { createPending: _created, ...rest } = note;
    return rest;
  });
}
