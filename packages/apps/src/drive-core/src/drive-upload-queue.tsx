import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import {
  driveUploadRowState,
  type DriveUploadRowState,
} from "@/drive-core/src/drive-upload-row-state";
import type {
  DriveUploadBatchView,
  DriveUploadItemView,
  DriveUploadQueueSnapshot,
} from "@/lib/offline/drive/upload/drive-upload-subscription";

/**
 * The upload queue of this account, live in every open tab. `null` when this
 * Drive has no queue (mock, guest) or before the first read.
 */
export function useDriveUploadQueue(
  operations?: Pick<DriveAPIOperations, "watchUploadQueue">,
): DriveUploadQueueSnapshot | null {
  const watch = operations?.watchUploadQueue;
  const [snapshot, setSnapshot] = useState<DriveUploadQueueSnapshot | null>(null);
  useEffect(() => {
    if (!watch) return;
    return watch(setSnapshot);
  }, [watch]);
  return watch ? snapshot : null;
}

export type DriveUploadQueueModel = {
  snapshot: DriveUploadQueueSnapshot;
  itemById: ReadonlyMap<string, DriveUploadItemView>;
  batchById: ReadonlyMap<string, DriveUploadBatchView>;
  failedCount: number;
  retryableCount: number;
  retry?: (itemId: string) => void;
  remove?: (itemId: string) => void;
  retryAllFailed?: () => void;
};

/** Items removed from this tab, so the batch toast does not count them as uploaded. */
const removedHere = new Set<string>();

export function wasDriveUploadRemovedHere(itemId: string): boolean {
  return removedHere.has(itemId);
}

export type DriveUploadQueueActions = Pick<
  DriveUploadQueueModel,
  "retry" | "remove" | "retryAllFailed"
>;

/** Lookups over one snapshot, plus the actions this Drive offers. */
export function buildDriveUploadQueueModel(
  snapshot: DriveUploadQueueSnapshot,
  actions: DriveUploadQueueActions = {},
): DriveUploadQueueModel {
  const failed = snapshot.items.filter((item) => item.status === "failed");
  return {
    snapshot,
    itemById: new Map(snapshot.items.map((item) => [item.id, item])),
    batchById: new Map(snapshot.batches.map((batch) => [batch.id, batch])),
    failedCount: failed.length,
    retryableCount: failed.filter((item) => item.canRetry).length,
    ...actions,
  };
}

/** The queue model for the rows, the sidebar, and the Uploads view. */
export function useDriveUploadQueueModel(
  snapshot: DriveUploadQueueSnapshot | null,
  operations: DriveAPIOperations | undefined,
  showError: (message: string) => void,
): DriveUploadQueueModel | null {
  const retryOne = operations?.retryQueuedUpload;
  const removeOne = operations?.removeQueuedUpload;
  const retryAll = operations?.retryAllFailedUploads;
  return useMemo(() => {
    if (!snapshot) return null;
    const fail = (error: unknown) =>
      showError(error instanceof Error ? error.message : String(error));
    return buildDriveUploadQueueModel(snapshot, {
      ...(retryOne ? { retry: (id: string) => void retryOne(id).catch(fail) } : {}),
      ...(removeOne
        ? {
            remove: (id: string) =>
              void removeOne(id)
                .then((removed) => {
                  if (removed) removedHere.add(id);
                })
                .catch(fail),
          }
        : {}),
      ...(retryAll ? { retryAllFailed: () => void retryAll().catch(fail) } : {}),
    });
  }, [removeOne, retryAll, retryOne, showError, snapshot]);
}

const DriveUploadQueueContext = createContext<DriveUploadQueueModel | null>(null);

export function DriveUploadQueueProvider({
  value,
  children,
}: {
  value: DriveUploadQueueModel | null;
  children: ReactNode;
}) {
  return (
    <DriveUploadQueueContext.Provider value={value}>{children}</DriveUploadQueueContext.Provider>
  );
}

export function useDriveUploadQueueContext(): DriveUploadQueueModel | null {
  return useContext(DriveUploadQueueContext);
}

/** Live state of one item, from the queue model when there is one. */
export function driveUploadRowStateFor(
  upload: NonNullable<DriveFile["upload"]>,
  model: DriveUploadQueueModel | null,
): DriveUploadRowState {
  if (!model) return driveUploadRowState(upload);
  const item = model.itemById.get(upload.id);
  return driveUploadRowState(upload, {
    ...(item ? { item, batch: model.batchById.get(item.batchId) } : {}),
    queueState: model.snapshot.state,
  });
}

/** Row state of a placeholder file, or null for a real file. */
export function useDriveUploadRowState(file: DriveFile): DriveUploadRowState | null {
  const model = useDriveUploadQueueContext();
  if (!file.upload) return null;
  return driveUploadRowStateFor(file.upload, model);
}
