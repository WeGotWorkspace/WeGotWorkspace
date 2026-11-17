import { isDocsCollabEditablePath } from "@/lib/files/docs-collab-text-files";
import {
  listDriveAvailability,
  removeDriveAvailability,
} from "@/lib/offline/drive/drive-availability-store";
import { removeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import {
  isProtectedFromPrune,
  prunerProtectedPaths,
} from "@/lib/offline/drive/drive-fetched-set-prune";

export type ClearAutoOfflineCopiesResult = {
  /** Paths whose local copy was removed. */
  removedPaths: string[];
};

/**
 * Settings › Offline › Clear cache: drop the file contents that background sync
 * saved on its own (`source: "auto"`). Left in place:
 * - copies the user saved by hand (`manual`): they asked for those;
 * - Docs documents: their local copy is the editor's own store, not a cache;
 * - paths with an open outbox write or a queued upload: the copy may be the only one.
 * Listing rows stay, so names and folders still show; the next sync (when on) fetches again.
 */
export async function clearAutoOfflineCopies(
  username: string,
): Promise<ClearAutoOfflineCopiesResult> {
  const rows = await listDriveAvailability(username);
  const protectedPaths = await prunerProtectedPaths(username);
  const removedPaths: string[] = [];
  for (const row of rows) {
    if (row.source !== "auto") continue;
    if (isDocsCollabEditablePath(row.id)) continue;
    if (isProtectedFromPrune(row.id, protectedPaths)) continue;
    await removeDriveContentBlob(username, row.id);
    await removeDriveAvailability(username, row.id);
    removedPaths.push(row.id);
  }
  return { removedPaths };
}
