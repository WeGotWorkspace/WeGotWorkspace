import { useCallback, useEffect, useRef } from "react";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import {
  useDriveUploadQueue,
  wasDriveUploadRemovedHere,
} from "@/drive-core/src/drive-upload-queue";
import type { DriveUploadQueueSnapshot } from "@/lib/offline/drive/upload/drive-upload-subscription";

type TrackedBatch = {
  itemIds: ReadonlySet<string>;
  /** A snapshot has shown the batch's items: from now on, gone means done. */
  seen: boolean;
};

export type DriveUploadBatchOutcome = { uploaded: number; failed: number };

/**
 * Outcome of a tracked batch once none of its files waits or uploads any
 * more, or null while it is still busy (or not seen in the queue yet).
 * Files removed from this tab do not count as uploaded.
 */
export function driveUploadBatchOutcome(
  snapshot: Pick<DriveUploadQueueSnapshot, "items">,
  batch: TrackedBatch,
  removedHere: (itemId: string) => boolean = wasDriveUploadRemovedHere,
): DriveUploadBatchOutcome | null {
  const items = snapshot.items.filter((item) => batch.itemIds.has(item.id));
  if (!batch.seen || items.some((item) => item.status !== "failed")) return null;
  const left = new Set(items.map((item) => item.id));
  let uploaded = 0;
  for (const id of batch.itemIds) {
    if (!left.has(id) && !removedHere(id)) uploaded += 1;
  }
  return { uploaded, failed: items.length };
}

/**
 * Toasts for the batches this tab queued: nothing says "Uploaded" until the
 * files are on the server. Returns `track(batchId, itemIds)` for the upload
 * action to call once a batch is stored.
 */
export function useDriveUploadBatchToasts(
  operations: DriveAPIOperations | undefined,
  toast: { show: (message: string) => void; showError: (message: string) => void },
) {
  const snapshot = useDriveUploadQueue(operations);
  const tracked = useRef(new Map<string, TrackedBatch>());
  const { show, showError } = toast;

  useEffect(() => {
    if (!snapshot) return;
    for (const [batchId, batch] of tracked.current) {
      if (snapshot.items.some((item) => batch.itemIds.has(item.id))) batch.seen = true;
      const outcome = driveUploadBatchOutcome(snapshot, batch);
      if (!outcome) continue;
      tracked.current.delete(batchId);
      const { uploaded, failed } = outcome;
      if (failed > 0) {
        showError(
          uploaded > 0
            ? driveLabels.uploadPartlyDoneToast(uploaded, uploaded + failed)
            : driveLabels.uploadFailedToast(failed),
        );
      } else if (uploaded > 0) {
        show(driveLabels.uploadDoneToast(uploaded));
      }
    }
  }, [show, showError, snapshot]);

  return useCallback((batchId: string, itemIds: readonly string[]) => {
    tracked.current.set(batchId, { itemIds: new Set(itemIds), seen: false });
  }, []);
}
