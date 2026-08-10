import type { Note } from "@/lib/models/note";
import type { NotesSharedNotebook } from "@/notes-core/src/notes-types";

export type NotesSeedData = {
  notes: Note[];
  notebooks: string[];
  tags: string[];
  sharedNotebooks?: NotesSharedNotebook[];
};

export type NotesAdapter = {
  getSeedData: () => NotesSeedData;
};
