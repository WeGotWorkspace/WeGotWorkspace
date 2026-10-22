import { noteFromRow } from "@/lib/offline/notes-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { noteCollabRoomKey } from "@/lib/offline/notes/notes-collab-rooms";
import { notesNotesTable } from "@/lib/offline/notes/notes-schema";
import { type PendingCollabRoom, uploadPendingCollabRooms } from "@/text-editor-core/docs-collab";
import { docsCollabIndexedDbKey } from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { buildNoteCollabUrls } from "./note-collab-path";

/**
 * Save note bodies typed offline in notes that are no longer open. Run it
 * after the outbox flush: a note whose create has not landed is skipped.
 */
export async function uploadPendingNoteBodies(username: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rooms: PendingCollabRoom[] = [];
  for (const row of await notesNotesTable(db).toArray()) {
    const note = noteFromRow(row);
    if (!note || note.createPending) continue;
    const room = noteCollabRoomKey(note.id);
    rooms.push({
      room,
      databaseName: docsCollabIndexedDbKey(room),
      urls: () => buildNoteCollabUrls(note.id),
      format: "markdown",
    });
  }
  await uploadPendingCollabRooms(rooms);
}
