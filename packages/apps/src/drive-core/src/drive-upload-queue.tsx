import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import {
  driveUploadNeedsSignIn,
  signInThenRetryDriveUploads,
} from "@/drive-core/src/drive-upload-sign-in";
import { driveUploadFolderRowState } from "@/drive-core/src/drive-upload-folder-row-state";
import {
  driveUploadRowState,
  type DriveUploadRowState,
} from "@/drive-core/src/drive-upload-row-state";
import {
  withDriveUploadBytesSent,
  subscribeDriveUploadBytesSent,
} from "@/lib/offline/drive/upload/drive-upload-live-bytes";
import type {
  DriveUploadBatchView,
  DriveUploadFolderView,
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
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    if (!watch) return;
    return watch(setSnapshot);
  }, [watch]);
  useEffect(() => subscribeDriveUploadBytesSent(() => setLiveTick((tick) => tick + 1)), []);
  return useMemo(
    () => (watch && snapshot ? withDriveUploadBytesSent(snapshot) : null),
    // liveTick: re-read the bytes this tab is sending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watch, snapshot, liveTick],
  );
}

export type DriveUploadQueueModel = {
  snapshot: DriveUploadQueueSnapshot;
  itemById: ReadonlyMap<string, DriveUploadItemView>;
  /** Folders of a folder upload (#1620), by their queue id. */
  folderById: ReadonlyMap<string, DriveUploadFolderView>;
  batchById: ReadonlyMap<string, DriveUploadBatchView>;
  failedCount: number;
  retryableCount: number;
  retry?: (itemId: string) => void;
  remove?: (itemId: string) => void;
  retryAllFailed?: () => void;
  /** *Retry* on a queue paused because the server is full (#1522). */
  resume?: () => void;
  /** *Choose another folder* on a `target_missing` or `forbidden` file (#1522). */
  chooseFolder?: (itemId: string) => void;
};

/** Items removed from this tab, so the batch toast does not count them as uploaded. */
const removedHere = new Set<string>();

export function wasDriveUploadRemovedHere(itemId: string): boolean {
  return removedHere.has(itemId);
}

export type DriveUploadQueueActions = Pick<
  DriveUploadQueueModel,
  "retry" | "remove" | "retryAllFailed" | "resume" | "chooseFolder"
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
    folderById: new Map((snapshot.folders ?? []).map((folder) => [folder.id, folder])),
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
  chooseFolder?: (itemId: string) => void,
): DriveUploadQueueModel | null {
  const retryOne = operations?.retryQueuedUpload;
  const removeOne = operations?.removeQueuedUpload;
  const retryAll = operations?.retryAllFailedUploads;
  const resume = operations?.resumeUploadQueue;
  return useMemo(() => {
    if (!snapshot) return null;
    const fail = (error: unknown) =>
      showError(error instanceof Error ? error.message : String(error));
    // An `auth` file without a session goes through sign-in first (#1522).
    const failedOnSignIn = (id?: string) =>
      driveUploadNeedsSignIn() &&
      snapshot.items.some(
        (item) =>
          item.status === "failed" &&
          item.error?.code === "auth" &&
          (id === undefined || item.id === id),
      );
    return buildDriveUploadQueueModel(snapshot, {
      ...(retryOne
        ? {
            retry: (id: string) => {
              if (failedOnSignIn(id)) signInThenRetryDriveUploads("auth");
              else void retryOne(id).catch(fail);
            },
          }
        : {}),
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
      ...(retryAll
        ? {
            retryAllFailed: () => {
              if (failedOnSignIn()) signInThenRetryDriveUploads("all");
              else void retryAll().catch(fail);
            },
          }
        : {}),
      ...(resume ? { resume: () => void resume().catch(fail) } : {}),
      ...(chooseFolder ? { chooseFolder } : {}),
    });
  }, [chooseFolder, removeOne, resume, retryAll, retryOne, showError, snapshot]);
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
  const folder = model.folderById.get(upload.id);
  if (folder) {
    return driveUploadFolderRowState(folder, {
      batch: model.batchById.get(folder.batchId),
      queueState: model.snapshot.state,
    });
  }
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
