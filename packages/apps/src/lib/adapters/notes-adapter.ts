import type { Note } from "@/lib/models/note";
import type {
  NotesDirectoryGroup,
  NotesNotebookCollection,
  NotesSharedNotebook,
} from "@/notes-core/src/notes-types";

export type NotesSeedData = {
  notes: Note[];
  notebooks: string[];
  tags: string[];
  sharedNotebooks?: NotesSharedNotebook[];
  notebookCollections?: NotesNotebookCollection[];
  groups?: NotesDirectoryGroup[];
};

export type NotesAdapter = {
  getSeedData: () => NotesSeedData;
};
