import type { Note } from "@/lib/models/note";
import { upsertNoteBodyPreviewInCache } from "@/lib/offline/notes-offline-store";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";
import { enrichNote, persistBestEffort } from "@/notes-core/src/notes-note-utils";

type SetNotes = (update: (notes: Note[]) => Note[]) => void;

/**
 * Project the collaborative title onto the list without a metadata upsert.
 * The collab save writes SUMMARY. Returns the same array when the title is
 * unchanged so a Yjs update for the body cannot loop setState.
 */
export function projectNoteTitle(setNotes: SetNotes, noteId: string, title: string): void {
  setNotes((prev) => {
    const result = mapNotesWithTitle(prev, noteId, title);
    if (!result.updated) return prev;
    const username = readOfflineNotesUsername();
    if (username) {
      persistBestEffort(upsertNoteBodyPreviewInCache(username, { ...result.updated, id: noteId }));
    }
    return result.notes;
  });
}

export function mapNotesWithTitle(
  notes: Note[],
  noteId: string,
  title: string,
): { notes: Note[]; updated: Note | undefined } {
  let updated: Note | undefined;
  const nextNotes = notes.map((note) => {
    if (note.id !== noteId || note.title === title) return note;
    const next = enrichNote({
      ...note,
      title,
      date: new Date().toISOString(),
    });
    updated = next;
    return next;
  });
  return { notes: updated ? nextNotes : notes, updated };
}
