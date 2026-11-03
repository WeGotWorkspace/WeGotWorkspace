import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import type { Note } from "@/lib/models/note";
import { subscribeNoteDropped } from "@/lib/offline/notes/notes-dropped-events";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";

/** A note deleted elsewhere leaves the list, and the person is told its offline edits went with it. */
export function useNoteDropped(
  setNotes: Dispatch<SetStateAction<Note[]>>,
  notify: (title: string) => void,
): void {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  useEffect(
    () =>
      subscribeNoteDropped(({ username, noteId, title }) => {
        if (username !== readOfflineNotesUsername()) return;
        setNotes((prev) => prev.filter((note) => note.id !== noteId));
        notifyRef.current(title);
      }),
    [setNotes],
  );
}
