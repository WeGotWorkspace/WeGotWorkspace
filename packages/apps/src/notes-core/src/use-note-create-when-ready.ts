import { useCallback, useEffect, useState } from "react";

/**
 * "New note" pressed before the notebook list has loaded (#2055). A new note
 * needs a real notebook; before the list is known there is none to pick, and
 * a note sent to a guessed one never reaches the server. The press waits and
 * creates the note as soon as the notebooks are known. Every account has a
 * default notebook, so that is once the list has loaded.
 */
export function useNoteCreateWhenReady(
  createNote: () => void,
  notebooksKnown: boolean,
): { createNote: () => void; pending: boolean } {
  // `pending` is for the screen: the detail pane shows that the note is on its way.
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!notebooksKnown || !pending) return;
    setPending(false);
    createNote();
  }, [createNote, notebooksKnown, pending]);

  const createWhenReady = useCallback(() => {
    if (notebooksKnown) createNote();
    else setPending(true);
  }, [createNote, notebooksKnown]);

  return { createNote: createWhenReady, pending };
}
