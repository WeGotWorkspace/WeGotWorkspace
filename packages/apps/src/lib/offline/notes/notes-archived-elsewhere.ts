import { NotesVjournalRequestError } from "@/lib/api/wgw/notes-vjournal";
import type { Note } from "@/lib/models/note";
import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import {
  getNoteFromCache,
  notesOutboxNoteId,
  removeOutboxMutation,
  upsertNoteInCache,
} from "@/lib/offline/notes-offline-store";
import { NOTES_DOMAIN } from "@/lib/offline/notes/notes-schema";
import { discardNoteCollabBuffer } from "@/lib/offline/notes/notes-collab-rooms";
import { isArchivedRefusal } from "@/text-editor-core/docs-collab/docs-collab-utils";

/**
 * The server refused a change because the note was archived elsewhere
 * (#1535). Archive wins: the queued change is dropped, and every tab says so,
 * the same way a note deleted elsewhere is (`notes-dropped-events`).
 */
export type NoteArchivedElsewhere = { username: string; noteId: string; title: string };

const topic = crossTabTopic(
  "wgw-notes-archived-elsewhere",
  (value): value is NoteArchivedElsewhere =>
    typeof (value as NoteArchivedElsewhere | null)?.noteId === "string",
);

export const announceNoteArchivedElsewhere = (event: NoteArchivedElsewhere): void =>
  topic.publish(event);
export const subscribeNoteArchivedElsewhere = topic.subscribe;

/** `409 note_archived` from a REST write or from the collab save. */
export function isNoteArchivedRefusal(error: unknown): boolean {
  if (error instanceof NotesVjournalRequestError) return error.code === "note_archived";
  return isArchivedRefusal(error);
}

/** Queued edits go; a queued restore, archive or delete still runs. */
async function removeQueuedEditsForNote(username: string, noteId: string): Promise<void> {
  for (const row of await listOutboxMutationsForDomain(username, NOTES_DOMAIN)) {
    if (row.op === "upsert" && notesOutboxNoteId(row) === noteId) {
      await removeOutboxMutation(username, row.id);
    }
  }
}

/**
 * Drop the note's queued edits and its unsaved body, keep the cached copy
 * as archived until the inbound sync brings the server copy, and announce it.
 * Returns that cached copy, or null when the cache does not have the note.
 */
export async function settleNoteArchivedElsewhere(
  username: string,
  noteId: string,
): Promise<Note | null> {
  const cached = await getNoteFromCache(username, noteId);
  await removeQueuedEditsForNote(username, noteId);
  await discardNoteCollabBuffer(noteId);
  const archived = cached ? { ...cached, archived: true } : null;
  if (archived) await upsertNoteInCache(username, archived, false);
  announceNoteArchivedElsewhere({ username, noteId, title: cached?.title?.trim() || "Untitled" });
  return archived;
}
