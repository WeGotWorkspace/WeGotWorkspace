import type { Note } from "@/lib/models/note";
import type { NotesMarkdownImportOperations } from "@/lib/models/notes-types";
import {
  createNote as createVjournalNote,
  deleteNote as deleteVjournalNote,
  getNote as getVjournalNote,
  isNotesAlreadyExists,
  noteFromVjournal,
  patchNote as patchVjournalNote,
} from "@/lib/api/wgw/notes-vjournal";
import { uploadNoteAttachmentImage } from "@/text-editor-core/docs-collab/docs-image-upload";
import { upsertNoteInCache } from "@/lib/offline/notes-offline-store";
import { notifyNotesBootstrapUpdated } from "@/lib/offline/notes-bootstrap-sync";

/**
 * The note is saved on the server by now. A failed cache write must not count
 * as a failed import (the run would delete the note); the next refresh loads it.
 */
async function publishSavedNote(username: string, note: Note): Promise<void> {
  try {
    await upsertNoteInCache(username, note, false);
  } catch {
    // Cache only.
  }
  notifyNotesBootstrapUpdated(username);
}

/**
 * WGW REST for the Markdown import (#1623): direct create with a client uid,
 * images into the note's hidden Drive folder, then one body PATCH. The
 * cache and other tabs hear of a note once, when it is final.
 */
export function createWgwNotesMarkdownImport(username: string): NotesMarkdownImportOperations {
  return {
    createNote: async ({ notebook, uid, title, categories }, opts) => {
      let created;
      try {
        created = await createVjournalNote(
          { notebookId: notebook.id, title, body: "", categories, uid },
          opts,
        );
      } catch (error) {
        // A retry after a lost answer: the first create did land, and the server
        // answers 409 for the uid. Carry on with that note (the API id is the uid),
        // but only when it is in this notebook; never touch a note elsewhere.
        if (!isNotesAlreadyExists(error)) throw error;
        const existing = await getVjournalNote(uid, opts);
        if (existing.notebookId !== notebook.id) throw error;
        created = existing;
      }
      // Not cached or announced yet: other tabs would load the empty body.
      return noteFromVjournal(created, [notebook]);
    },
    deleteNote: async (note, opts) => {
      await deleteVjournalNote(note.id, opts);
    },
    readBody: async (note, notebook, opts) => {
      const row = await getVjournalNote(note.id, opts);
      return { note: noteFromVjournal(row, [notebook]), body: row.body ?? "" };
    },
    publishNote: (note) => publishSavedNote(username, note),
    uploadImage: async (note, file, opts) => {
      const uploaded = await uploadNoteAttachmentImage(
        { groupSlug: note.groupSlug },
        note.id,
        file,
        opts,
      );
      return { nodeId: uploaded.nodeId };
    },
    writeBody: async (note, body, notebook, opts) => {
      const saved = await patchVjournalNote(
        note.id,
        { body },
        { signal: opts?.signal, ifMatch: note.etag },
      );
      const updated = noteFromVjournal(saved, [notebook]);
      await publishSavedNote(username, updated);
      return updated;
    },
  };
}
