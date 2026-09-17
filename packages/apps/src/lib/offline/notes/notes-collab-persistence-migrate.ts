import { migrateNoteCollabRoom } from "@/lib/offline/notes/notes-collab-rooms";

type MigrateNoteCollabPersistenceArgs = {
  username: string;
  notebook: string;
  tempNoteId: string;
  savedNoteId: string;
  archived?: boolean;
};

/**
 * Move the UID-keyed collab crash buffer from a temporary offline id to the
 * saved server UID. Drive `.notes` paths are not used.
 */
export async function migrateNoteCollabPersistenceAfterIdRemap({
  tempNoteId,
  savedNoteId,
}: MigrateNoteCollabPersistenceArgs): Promise<void> {
  if (!tempNoteId || !savedNoteId || tempNoteId === savedNoteId) return;
  await migrateNoteCollabRoom(tempNoteId, savedNoteId);
}
