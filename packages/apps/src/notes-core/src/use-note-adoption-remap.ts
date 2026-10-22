import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { Note } from "@/lib/models/note";
import { subscribeNoteAdoptions } from "@/lib/offline/notes/notes-adoption-events";
import { migrateNoteCollabPersistenceAfterIdRemap } from "@/lib/offline/notes/notes-collab-persistence-migrate";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";

/** A body typed in the temp room after the flush moved it (the editor was still open). */
const LEFTOVER_ROOM_MOVE_DELAY_MS = 1500;

/**
 * Swap a `local-*` note for its server id when a create is adopted, in this
 * tab or another one. Without this the list kept the temp row next to the
 * server note and the URL and editor stayed on the temp id until a reload.
 */
export function useNoteAdoptionRemap({
  setNotes,
  setActiveId,
  setSelectedIds,
}: {
  setNotes: Dispatch<SetStateAction<Note[]>>;
  setActiveId: Dispatch<SetStateAction<string>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
}): void {
  useEffect(
    () =>
      subscribeNoteAdoptions(({ username, localId, serverId }) => {
        if (username !== readOfflineNotesUsername()) return;
        setNotes((prev) => remapAdoptedNote(prev, localId, serverId));
        setActiveId((current) => (current === localId ? serverId : current));
        setSelectedIds((current) =>
          current.includes(localId)
            ? current.map((id) => (id === localId ? serverId : id))
            : current,
        );
        window.setTimeout(() => {
          void migrateNoteCollabPersistenceAfterIdRemap({
            username,
            notebook: "",
            tempNoteId: localId,
            savedNoteId: serverId,
          });
        }, LEFTOVER_ROOM_MOVE_DELAY_MS);
      }),
    [setActiveId, setNotes, setSelectedIds],
  );
}

/** Rename the temp row, or drop it when the server note is already listed. */
export function remapAdoptedNote(notes: Note[], localId: string, serverId: string): Note[] {
  if (!notes.some((note) => note.id === localId)) return notes;
  if (notes.some((note) => note.id === serverId)) {
    return notes.filter((note) => note.id !== localId);
  }
  return notes.map((note) => (note.id === localId ? { ...note, id: serverId } : note));
}
