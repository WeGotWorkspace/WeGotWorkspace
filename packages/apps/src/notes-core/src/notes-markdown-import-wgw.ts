import type { NotesMarkdownImportOperations } from "@/notes-core/src/notes-types";
import {
  createNote as createVjournalNote,
  noteFromVjournal,
  patchNote as patchVjournalNote,
} from "@/lib/api/wgw/notes-vjournal";
import { uploadNoteAttachmentImage } from "@/text-editor-core/docs-collab/docs-image-upload";
import { upsertNoteInCache } from "@/lib/offline/notes-offline-store";
import { notifyNotesBootstrapUpdated } from "@/lib/offline/notes-bootstrap-sync";

/**
 * WGW REST for the Markdown import (#1623): direct create with a client uid,
 * images into the note's hidden Drive folder, then one body PATCH. Other
 * tabs are told after each write, like after an archive or delete.
 */
export function createWgwNotesMarkdownImport(username: string): NotesMarkdownImportOperations {
  return {
    createNote: async ({ notebook, uid, title, categories }, opts) => {
      const created = await createVjournalNote(
        { notebookId: notebook.id, title, body: "", categories, uid },
        opts,
      );
      const note = noteFromVjournal(created, [notebook]);
      await upsertNoteInCache(username, note, false);
      notifyNotesBootstrapUpdated(username);
      return note;
    },
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
      await upsertNoteInCache(username, updated, false);
      notifyNotesBootstrapUpdated(username);
      return updated;
    },
  };
}
