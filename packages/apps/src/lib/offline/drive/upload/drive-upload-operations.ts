import { driveJmapSession } from "@/lib/api/wgw/drive-jmap";
import { normalizeApiVirtualPath } from "@/lib/files/api-path";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  describeDriveUploadBatchConflicts,
  driveUploadSessionVersionCheck,
} from "@/lib/offline/drive/upload/drive-upload-conflicts";
import { onDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import { sharedDriveUploadQueueWatch } from "@/lib/offline/drive/upload/drive-upload-queue-watch";
import { startDriveUploader } from "@/lib/offline/drive/upload/drive-upload-runner";
import { checkDriveUploadBatchSpace } from "@/lib/offline/drive/upload/drive-upload-space-check";
import {
  cancelDriveUploadBatch,
  enqueueDriveUploadBatch,
  recordDriveUploadBatchSpaceCheck,
  releaseDriveUploadBatch,
  removeDriveUploadItem,
  resumeDriveUploadQueue,
  retargetDriveUploadItem,
  retryAllFailedDriveUploads,
  retryDriveUploadItem,
  type DriveUploadBatchReleaseAnswers,
} from "@/lib/offline/drive/upload/drive-upload-store";
import type { DriveUploadSpaceCheck } from "@/lib/offline/drive/upload/drive-upload-schema";
import { resolveDriveUploadTarget } from "@/lib/offline/drive/upload/drive-upload-target";

/**
 * Store a pick or drop as one batch, then its space pre-check on it, so the
 * batch dialog (#1521) can read it before the batch is released.
 */
async function enqueueWithSpaceCheck(username: string, input: { cwd: string; files: File[] }) {
  const folderPath = normalizeApiVirtualPath(input.cwd);
  const targetFolder = await resolveDriveUploadTarget(username, folderPath);
  const batch = await enqueueDriveUploadBatch(username, {
    folderPath,
    targetFolder,
    files: input.files,
    // The caller releases the batch next (see `queueDriveUploadBatch`).
    notify: false,
  });
  const spaceCheck: DriveUploadSpaceCheck = await checkDriveUploadBatchSpace(
    username,
    batch.batchId,
  ).catch((error: unknown) => {
    console.warn("[drive-upload] space pre-check failed", error);
    return { status: "unknown" };
  });
  await recordDriveUploadBatchSpaceCheck(username, batch.batchId, spaceCheck);
  startDriveUploader(username);
  return { batchId: batch.batchId, itemIds: batch.itemIds, spaceCheck };
}

/**
 * The upload queue operations of signed-in Drive (#1501, #1519, #1520), the
 * matching part of `DriveAPIOperations` (checked where they are spread in).
 */
export function driveUploadQueueOperations(username: string) {
  return {
    enqueueUploads: (input: { cwd: string; files: File[] }) =>
      enqueueWithSpaceCheck(username, input),
    releaseUploadBatch: (batchId: string, answers: DriveUploadBatchReleaseAnswers) =>
      releaseDriveUploadBatch(username, batchId, answers),
    describeUploadConflicts: async (batchId: string) => {
      // The live Session decides when there is one; offline, the last one this device saw.
      const live = readBrowserOnline()
        ? await driveJmapSession().then(
            (session) => session.uploadCapabilities,
            () => null,
          )
        : null;
      const versionCheck = driveUploadSessionVersionCheck(username, live);
      return describeDriveUploadBatchConflicts(username, batchId, versionCheck);
    },
    cancelUploadBatch: (batchId: string) => cancelDriveUploadBatch(username, batchId),
    removeQueuedUpload: (itemId: string) => removeDriveUploadItem(username, itemId),
    retryQueuedUpload: (itemId: string) => retryDriveUploadItem(username, itemId),
    retryAllFailedUploads: () => retryAllFailedDriveUploads(username),
    retargetQueuedUpload: async (itemId: string, cwd: string) => {
      const folderPath = normalizeApiVirtualPath(cwd);
      const targetFolder = await resolveDriveUploadTarget(username, folderPath);
      return retargetDriveUploadItem(username, itemId, { folderPath, targetFolder });
    },
    resumeUploadQueue: () => resumeDriveUploadQueue(username),
    subscribeUploadQueue: (listener: () => void) => onDriveUploadQueueChanged(username, listener),
    watchUploadQueue: sharedDriveUploadQueueWatch(username),
  };
}

/**
 * `uploadFiles` while offline: the files go to the upload queue as `Blob`s,
 * released right away (there is no dialog on this path), and upload once the
 * connection is back. Never base64.
 */
export async function queueOfflineDriveUploadFiles(
  username: string,
  input: { cwd: string; files: File[] },
): Promise<void> {
  const { batchId } = await enqueueWithSpaceCheck(username, input);
  await releaseDriveUploadBatch(username, batchId, { keepOffline: "remove" });
}
