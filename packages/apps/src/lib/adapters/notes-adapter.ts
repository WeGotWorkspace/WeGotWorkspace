import type { Note } from "@/lib/models/note";
import type { NotesSharedNotebook } from "@/notes-core/src/notes-types";

export type NotesSeedData = {
  notes: Note[];
  notebooks: string[];
  tags: string[];
  sharedNotebooks?: NotesSharedNotebook[];
  /** Personal notebook names with outgoing directory shares (owner sidebar pip). */
  notebooksWithShares?: string[];
};

export type NotesAdapter = {
  getSeedData: () => NotesSeedData;
};
