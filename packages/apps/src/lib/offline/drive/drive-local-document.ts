import { isDocsCollabEditablePath } from "@/lib/files/docs-collab-text-files";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  normalizeDocsAvailabilityPath,
  removeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { removeDriveAvailability } from "@/lib/offline/drive/drive-availability-store";
import { removeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import { rememberKeptUnsavedDocuments } from "@/lib/offline/drive/drive-fetched-set-prune";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import {
  clearDocsCollabOfflinePersistence,
  hasDocsCollabPendingServerSave,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";

/** A collab document whose local text has not reached the server yet. */
export function documentHasUnsavedLocalWork(apiPath: string): Promise<boolean> {
  return hasDocsCollabPendingServerSave(normalizeDocsAvailabilityPath(apiPath));
}

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
  if (await documentHasUnsavedLocalWork(id)) {
    await rememberKeptUnsavedDocuments(username, [id]);
    return "kept";
  }
  if (isDocsCollabEditablePath(id)) {
    await removeDocsAvailability(username, id);
    await clearDocsCollabOfflinePersistence(id);
  }
  return "dropped";
}

/**
 * Drop a node gone from the server: its drive row and the offline copies Drive
 * keeps for it (content blob, availability row), as the tree-crawl prune does.
 */
export async function deleteDriveEntryByPath(username: string, apiPath: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const id = normalizeDocsAvailabilityPath(apiPath);
  await removeDriveContentBlob(username, id);
  await removeDriveAvailability(username, id);
  await driveEntriesTable(db).delete(id);
}
