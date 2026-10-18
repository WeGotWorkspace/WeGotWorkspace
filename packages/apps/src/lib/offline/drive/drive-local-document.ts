import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  normalizeDocsAvailabilityPath,
  removeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { rememberKeptUnsavedDocuments } from "@/lib/offline/drive/drive-fetched-set-prune";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import {
  clearDocsCollabOfflinePersistence,
  hasDocsCollabPendingServerSave,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";

/**
 * Keep the drive row, pin, and collab database when the document still has
 * unsaved local work. Otherwise drop the pin and the database. The caller
 * deletes the drive row only after `"dropped"`, so the FileNode id is still
 * cached while the identity database is checked and cleared.
 */
export async function retainOrDropLocalDocument(
  username: string,
  apiPath: string,
): Promise<"kept" | "dropped"> {
  const id = normalizeDocsAvailabilityPath(apiPath);
  if (await hasDocsCollabPendingServerSave(id)) {
    await rememberKeptUnsavedDocuments(username, [id]);
    return "kept";
  }
  if (isDocsCollabEditablePath(id)) {
    await removeDocsAvailability(username, id);
    await clearDocsCollabOfflinePersistence(id);
  }
  return "dropped";
}

export async function deleteDriveEntryByPath(username: string, apiPath: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await driveEntriesTable(db).delete(normalizeDocsAvailabilityPath(apiPath));
}
