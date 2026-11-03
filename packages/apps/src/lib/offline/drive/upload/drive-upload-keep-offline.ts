import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readOfflineDeviceContentSettings,
  type OfflineDeviceContentSettings,
} from "@/lib/offline/core/offline-device-settings";
import { chooseDriveUploadHandOff } from "@/lib/offline/drive/upload/drive-upload-handoff";
import {
  driveUploadItemsTable,
  type OfflineDriveUploadItemRow,
} from "@/lib/offline/drive/upload/drive-upload-schema";

/** A queued file the device offline rule would not keep on its own. */
export type DriveUploadKeepOfflineFile = { itemId: string; name: string; size: number };

/**
 * The keep-offline question of a batch (#1521): the files the rule would
 * not keep, and the rule's size limit, or null when *Make files available
 * offline* is switched off (then every file is asked about).
 */
export type DriveUploadKeepOfflineQuestion = {
  limitBytes: number | null;
  files: DriveUploadKeepOfflineFile[];
};

/**
 * Same rule as the hand-off (`chooseDriveUploadHandOff`): a file the rule
 * keeps becomes an automatic offline copy without asking. Files without a
 * local copy (direct uploads), files that already failed, and Docs-editable
 * files (they keep their own offline path) are left out. Null when no file
 * needs the question.
 */
export function driveUploadKeepOfflineQuestion(
  items: readonly Pick<
    OfflineDriveUploadItemRow,
    "id" | "name" | "size" | "localCopy" | "status"
  >[],
  settings: OfflineDeviceContentSettings,
): DriveUploadKeepOfflineQuestion | null {
  const files = items
    .filter((item) => item.localCopy && item.status !== "failed")
    // Asked only when the answer changes what happens to the file.
    .filter(
      (item) =>
        chooseDriveUploadHandOff(item.name, item.size, "keep", settings) !==
        chooseDriveUploadHandOff(item.name, item.size, "remove", settings),
    )
    .map((item) => ({ itemId: item.id, name: item.name, size: item.size }));
  if (files.length === 0) return null;
  return { limitBytes: settings.contentSyncEnabled ? settings.maxFileSizeBytes : null, files };
}

/** The keep-offline question of a stored batch, with this device's settings now. */
export async function describeDriveUploadBatchKeepOffline(
  username: string,
  batchId: string,
): Promise<DriveUploadKeepOfflineQuestion | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const items = await driveUploadItemsTable(db)
    .where("batchId")
    .equals(batchId)
    .sortBy("createdAt");
  return driveUploadKeepOfflineQuestion(items, readOfflineDeviceContentSettings());
}
