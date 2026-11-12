import { useCallback, useEffect, useRef } from "react";

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
): () => void {
  const waitingRef = useRef(false);

  useEffect(() => {
    if (!notebooksKnown || !waitingRef.current) return;
    waitingRef.current = false;
    createNote();
  }, [createNote, notebooksKnown]);

  return useCallback(() => {
    if (notebooksKnown) createNote();
    else waitingRef.current = true;
  }, [createNote, notebooksKnown]);
}
