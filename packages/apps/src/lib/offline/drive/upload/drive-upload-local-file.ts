import { uploadFromMemory } from "@/lib/offline/drive/upload/drive-upload-memory";
import {
  readDriveUploadBlob,
  readDriveUploadItem,
} from "@/lib/offline/drive/upload/drive-upload-store";

/** A file in the upload queue whose bytes this tab cannot read. */
export class DriveUploadLocalFileMissingError extends Error {
  constructor(name: string) {
    super(`"${name}" is still uploading from another window. Download it there, or wait.`);
    this.name = "DriveUploadLocalFileMissingError";
  }
}

/**
 * The bytes of a file that is still in the upload queue, from this device:
 * the stored copy, or the file the user picked when this tab keeps it in
 * memory. Null when the item is gone (it finished or was removed).
 */
export async function readQueuedDriveUploadFile(
  username: string,
  itemId: string,
): Promise<{ name: string; blob: Blob } | null> {
  const item = await readDriveUploadItem(username, itemId);
  if (!item) return null;
  const blob = item.localCopy
    ? await readDriveUploadBlob(username, itemId)
    : (uploadFromMemory(itemId) ?? null);
  if (!blob) throw new DriveUploadLocalFileMissingError(item.name);
  return { name: item.name, blob };
}

/**
 * *Download* on a file that is still uploading: saves this device's copy, so
 * it does not have to wait for the server. False when the item is gone.
 */
export async function downloadQueuedDriveUpload(
  username: string,
  itemId: string,
): Promise<boolean> {
  const file = await readQueuedDriveUploadFile(username, itemId);
  if (!file) return false;
  const { triggerBrowserBlobDownload } = await import("@/lib/offline/docs/docs-offline-download");
  triggerBrowserBlobDownload(file.blob, file.name);
  return true;
}
