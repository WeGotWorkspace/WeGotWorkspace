import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import type { Note } from "@/lib/models/note";
import { subscribeNoteArchivedElsewhere } from "@/lib/offline/notes/notes-archived-elsewhere";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";

/**
 * A note archived elsewhere refused this device's change (#1535). Archive
 * wins: the note shows as archived, and the person is told the change was
 * not saved. Same shape as `useNoteDropped` for a note deleted elsewhere.
 */
export function useNoteArchivedElsewhere(
  setNotes: Dispatch<SetStateAction<Note[]>>,
  notify: (title: string) => void,
): void {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  useEffect(
    () =>
      subscribeNoteArchivedElsewhere(({ username, noteId, title }) => {
        if (username !== readOfflineNotesUsername()) return;
        setNotes((prev) =>
          prev.map((note) => (note.id === noteId ? { ...note, archived: true } : note)),
        );
        notifyRef.current(title);
      }),
    [setNotes],
  );
}
