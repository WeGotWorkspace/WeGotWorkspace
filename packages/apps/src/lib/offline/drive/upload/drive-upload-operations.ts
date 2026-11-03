import { driveJmapSession } from "@/lib/api/wgw/drive-jmap";
import { normalizeApiVirtualPath } from "@/lib/files/api-path";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  describeDriveUploadBatchConflicts,
  driveUploadSessionVersionCheck,
} from "@/lib/offline/drive/upload/drive-upload-conflicts";
import { downloadQueuedDriveUpload } from "@/lib/offline/drive/upload/drive-upload-local-file";
import {
  notifyDriveUploadQueueChanged,
  onDriveUploadQueueChanged,
} from "@/lib/offline/drive/upload/drive-upload-events";
import { describeDriveUploadBatchKeepOffline } from "@/lib/offline/drive/upload/drive-upload-keep-offline";
import {
  isAskingUploadBatchHere,
  isUploadBatchAskedInAnotherTab,
  startAskingUploadBatch,
  stopAskingUploadBatch,
} from "@/lib/offline/drive/upload/drive-upload-memory";
import { sharedDriveUploadQueueWatch } from "@/lib/offline/drive/upload/drive-upload-queue-watch";
import { startDriveUploader } from "@/lib/offline/drive/upload/drive-upload-runner";
import { checkDriveUploadBatchSpace } from "@/lib/offline/drive/upload/drive-upload-space-check";
import {
  cancelDriveUploadBatch,
  dismissDriveUploadBatchNotices,
  enqueueDriveUploadBatch,
  readDriveUploadQueueRows,
  recordDriveUploadBatchSpaceCheck,
  releaseDriveUploadBatch,
  resumeDriveUploadQueue,
  retargetDriveUploadItem,
  retryAllFailedDriveUploads,
  type DriveUploadBatchReleaseAnswers,
} from "@/lib/offline/drive/upload/drive-upload-store";
import {
  applyDriveUploadFolderChoice,
  describeDriveUploadFolderConflicts,
} from "@/lib/offline/drive/upload/drive-upload-folder-conflicts";
import {
  enqueueDriveUploadFolderBatch,
  type DriveUploadTreeInput,
} from "@/lib/offline/drive/upload/drive-upload-folder-enqueue";
import {
  removeDriveUploadTreeItem,
  retryDriveUploadTreeItem,
} from "@/lib/offline/drive/upload/drive-upload-folder-store";
import type {
  DriveUploadFolderOnExisting,
  DriveUploadSpaceCheck,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import { resolveDriveUploadTarget } from "@/lib/offline/drive/upload/drive-upload-target";
import {
  hasDriveUploadBatchQuestions,
  type DriveUploadBatchQuestions,
} from "@/lib/offline/drive/upload/drive-upload-batch-questions";

async function sessionVersionCheck(username: string) {
  // The live Session decides when there is one; offline, the last one this device saw.
  const live = readBrowserOnline()
    ? await driveJmapSession().then(
        (session) => session.uploadCapabilities,
        () => null,
      )
    : null;
  return driveUploadSessionVersionCheck(username, live);
}

async function describeConflicts(username: string, batchId: string) {
  return describeDriveUploadBatchConflicts(username, batchId, await sessionVersionCheck(username));
}

async function describeBatchQuestions(
  username: string,
  batchId: string,
  spaceCheck: DriveUploadSpaceCheck | undefined,
): Promise<DriveUploadBatchQuestions> {
  const versionCheck = await sessionVersionCheck(username);
  const conflicts = await describeDriveUploadBatchConflicts(username, batchId, versionCheck).catch(
    (error: unknown) => {
      console.warn("[drive-upload] conflict check failed", error);
      return null;
    },
  );
  const folders = await describeDriveUploadFolderConflicts(username, batchId, versionCheck).catch(
    (error: unknown) => {
      console.warn("[drive-upload] folder conflict check failed", error);
      return null;
    },
  );
  return {
    // Only a folder upload with a taken name has this step.
    ...(folders ? { folders } : {}),
    space: spaceCheck && spaceCheck.status === "does_not_fit" ? spaceCheck : null,
    conflicts: conflicts && conflicts.conflicts.length > 0 ? conflicts : null,
    keepOffline: await describeDriveUploadBatchKeepOffline(username, batchId).catch(
      (error: unknown) => {
        console.warn("[drive-upload] keep-offline check failed", error);
        return null;
      },
    ),
  };
}

/**
 * Batches left waiting for an answer by a tab that is gone (closed or
 * reloaded while its dialog was open). This tab takes them over and asks
 * again; a batch another open tab still asks about is left to that tab.
 */
async function claimUnansweredBatches(username: string) {
  const { batches, items } = await readDriveUploadQueueRows(username);
  const claimed: { batchId: string; itemIds: string[]; questions: DriveUploadBatchQuestions }[] =
    [];
  for (const batch of batches) {
    if (batch.status !== "awaiting_input" || isAskingUploadBatchHere(batch.id)) continue;
    if (await isUploadBatchAskedInAnotherTab(batch.id)) continue;
    startAskingUploadBatch(batch.id);
    claimed.push({
      batchId: batch.id,
      itemIds: items.filter((item) => item.batchId === batch.id).map((item) => item.id),
      questions: await describeBatchQuestions(username, batch.id, batch.spaceCheck),
    });
  }
  return claimed;
}

/** A pick or drop: files, or a folder tree (#1620), which replaces `files` when set. */
export type DriveUploadEnqueueInput = { cwd: string; files: File[]; tree?: DriveUploadTreeInput };

/**
 * Store a pick or drop as one batch, then its space pre-check on it, so the
 * batch dialog (#1521) can read it before the batch is released.
 */
async function enqueueWithSpaceCheck(username: string, input: DriveUploadEnqueueInput) {
  const folderPath = normalizeApiVirtualPath(input.cwd);
  const targetFolder = await resolveDriveUploadTarget(username, folderPath);
  // The caller releases the batch next (see `queueDriveUploadBatch`).
  const batch: { batchId: string; itemIds: string[]; folderIds?: string[] } = input.tree
    ? await enqueueDriveUploadFolderBatch(username, {
        folderPath,
        targetFolder,
        tree: input.tree,
        notify: false,
      })
    : await enqueueDriveUploadBatch(username, {
        folderPath,
        targetFolder,
        files: input.files,
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
  return {
    batchId: batch.batchId,
    itemIds: batch.itemIds,
    ...(batch.folderIds ? { folderIds: batch.folderIds } : {}),
    spaceCheck,
  };
}

/**
 * The upload action's enqueue: store the batch, then work out the dialog's
 * questions. Only a batch with questions is shown as waiting for an answer;
 * one without is released by the caller right away, so it never flashes.
 */
async function enqueueAndDescribe(username: string, input: DriveUploadEnqueueInput) {
  const stored = await enqueueWithSpaceCheck(username, input);
  startAskingUploadBatch(stored.batchId);
  const questions = await describeBatchQuestions(username, stored.batchId, stored.spaceCheck);
  if (hasDriveUploadBatchQuestions(questions)) notifyDriveUploadQueueChanged(username);
  return { ...stored, questions };
}

/**
 * The upload queue operations of signed-in Drive (#1501, #1519, #1520), the
 * matching part of `DriveAPIOperations` (checked where they are spread in).
 */
export function driveUploadQueueOperations(username: string) {
  return {
    enqueueUploads: (input: DriveUploadEnqueueInput) => enqueueAndDescribe(username, input),
    releaseUploadBatch: async (
      batchId: string,
      answers: DriveUploadBatchReleaseAnswers & { folderConflict?: DriveUploadFolderOnExisting },
    ) => {
      stopAskingUploadBatch(batchId);
      // Before the release, so the uploader never starts a folder under its old name.
      if (answers.folderConflict) {
        await applyDriveUploadFolderChoice(username, batchId, answers.folderConflict);
      }
      await releaseDriveUploadBatch(username, batchId, answers);
    },
    describeUploadConflicts: (batchId: string) => describeConflicts(username, batchId),
    claimUnansweredUploadBatches: () => claimUnansweredBatches(username),
    cancelUploadBatch: async (batchId: string) => {
      stopAskingUploadBatch(batchId);
      await cancelDriveUploadBatch(username, batchId);
    },
    dismissUploadNotices: (batchId: string) => dismissDriveUploadBatchNotices(username, batchId),
    removeQueuedUpload: (itemId: string) => removeDriveUploadTreeItem(username, itemId),
    retryQueuedUpload: (itemId: string) => retryDriveUploadTreeItem(username, itemId),
    retryAllFailedUploads: () => retryAllFailedDriveUploads(username),
    downloadQueuedUpload: (itemId: string) => downloadQueuedDriveUpload(username, itemId),
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
