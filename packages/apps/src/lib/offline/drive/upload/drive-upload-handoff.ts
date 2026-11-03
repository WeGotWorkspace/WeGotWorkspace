import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { fileNodeToDirectoryEntry } from "@/lib/api/wgw/drive-jmap";
import type { JmapFileNode } from "@/lib/jmap-client";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readOfflineDeviceContentSettings,
  type OfflineDeviceContentSettings,
} from "@/lib/offline/core/offline-device-settings";
import { driveEntryRowFromEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import {
  driveAvailabilityTable,
  driveContentBlobsTable,
  driveEntriesTable,
  type OfflineDriveAvailabilitySource,
} from "@/lib/offline/drive/drive-schema";
import { isQuotaExceededError } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { findUploadPlaceholder } from "@/lib/offline/drive/upload/drive-upload-placeholders";
import {
  driveUploadBatchesTable,
  driveUploadBlobsTable,
  driveUploadItemsTable,
  type DriveUploadKeepOffline,
  type DriveUploadNotice,
  type OfflineDriveUploadItemRow,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import { notifyDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import { dropItemRows } from "@/lib/offline/drive/upload/drive-upload-store";
import { cachedDriveFolderPath } from "@/lib/offline/drive/upload/drive-upload-target";

/** What happens to the uploaded `Blob` on this device. */
export type DriveUploadHandOff = OfflineDriveAvailabilitySource | "dropped";

/**
 * Same rule as offline content sync. Files the rule keeps on its own become an
 * automatic copy; the rest follow the batch's answer (`keep` = a manual copy,
 * like pinning, with no size check). Docs-editable files keep their own
 * offline path (the collab database), so their `Blob` is not handed off.
 */
export function chooseDriveUploadHandOff(
  path: string,
  size: number,
  keepOffline: DriveUploadKeepOffline,
  settings: OfflineDeviceContentSettings,
): DriveUploadHandOff {
  if (isDocsCollabEditablePath(path)) return "dropped";
  if (settings.contentSyncEnabled && size <= settings.maxFileSizeBytes) return "auto";
  return keepOffline === "keep" ? "manual" : "dropped";
}

export type CompleteDriveUploadInput = {
  item: OfflineDriveUploadItemRow;
  keepOffline: DriveUploadKeepOffline;
  node: JmapFileNode;
  finalName: string;
  /** The stored bytes; null for a direct upload, which keeps no copy. */
  blob: Blob | null;
};

export type CompleteDriveUploadResult = {
  /** Cache path of the new row, or null when the folder is not cached here. */
  path: string | null;
  handOff: DriveUploadHandOff;
};

function accountDb(username: string) {
  return offlineDbForAccount(offlineAccountKeyFromUsername(username));
}

/**
 * Swap the placeholder for the real FileNode row, hand the `Blob` to the
 * offline content store, and drop the queue item, in one transaction. The
 * device setting is read now, not when the file was queued. `entryModifiedAt`
 * is the server's `modified`, and `syncedAt` is never earlier than that, so
 * content sync does not download the file again.
 */
export async function completeDriveUpload(
  username: string,
  input: CompleteDriveUploadInput,
): Promise<CompleteDriveUploadResult> {
  const path = await finalCachePath(username, input);
  const handOff =
    path && input.blob
      ? chooseDriveUploadHandOff(
          path,
          input.blob.size,
          input.keepOffline,
          readOfflineDeviceContentSettings(),
        )
      : "dropped";
  try {
    await writeCompletion(username, input, path, handOff);
    return { path, handOff };
  } catch (error) {
    if (handOff === "dropped" || !isQuotaExceededError(error)) throw error;
    // The file is on the server; only the offline copy did not fit.
    await writeCompletion(username, input, path, "dropped", {
      type: "offline_copy_failed",
      itemName: input.finalName,
      reason: "quota",
    });
    return { path, handOff: "dropped" };
  } finally {
    notifyDriveUploadQueueChanged(username);
  }
}

async function finalCachePath(
  username: string,
  input: CompleteDriveUploadInput,
): Promise<string | null> {
  const placeholder = await findUploadPlaceholder(username, input.item.id);
  const folder =
    placeholder?.parentPath ?? (await cachedDriveFolderPath(username, input.item.targetFolder.id));
  return folder ? `${folder}/${input.finalName}` : null;
}

async function writeCompletion(
  username: string,
  input: CompleteDriveUploadInput,
  path: string | null,
  handOff: DriveUploadHandOff,
  notice?: DriveUploadNotice,
): Promise<void> {
  const db = accountDb(username);
  const entries = driveEntriesTable(db);
  const contentBlobs = driveContentBlobsTable(db);
  const availability = driveAvailabilityTable(db);
  const batches = driveUploadBatchesTable(db);
  const queueTables = [batches, driveUploadItemsTable(db), driveUploadBlobsTable(db)];
  const entry = path ? fileNodeToDirectoryEntry(`/${path}`, input.node) : null;
  await db.transaction("rw", [entries, contentBlobs, availability, ...queueTables], async () => {
    if (notice) {
      const batch = await batches.get(input.item.batchId);
      if (batch) await batches.put({ ...batch, notices: [...batch.notices, notice] });
    }
    await dropItemRows(username, input.item);
    if (!entry || !path) return;
    await entries.put(driveEntryRowFromEntry(entry));
    if (handOff === "dropped" || !input.blob) return;
    const now = Date.now();
    await contentBlobs.put({
      id: path,
      size: input.blob.size,
      mimeType: input.blob.type || input.item.mimeType,
      syncedAt: Math.max(now, entry.time * 1000),
      blob: input.blob,
    });
    await availability.put({
      id: path,
      source: handOff,
      pinnedAt: now,
      lastSyncedAt: now,
      entryModifiedAt: entry.time,
    });
  });
}
