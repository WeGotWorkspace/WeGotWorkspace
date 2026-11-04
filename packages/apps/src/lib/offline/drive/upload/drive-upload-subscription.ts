import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { onDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import {
  canRetryDriveUpload,
  isDriveUploadQueuePausedServerFull,
  readDriveUploadQueueRows,
  type DriveUploadQueueRows,
} from "@/lib/offline/drive/upload/drive-upload-store";
import {
  driveUploadSubtreeIds,
  isCreatedUploadFolder,
} from "@/lib/offline/drive/upload/drive-upload-folder-rows";
import type {
  OfflineDriveUploadItemRow,
  DriveUploadBatchStatus,
  DriveUploadItemError,
  DriveUploadItemStatus,
  DriveUploadKeepOffline,
  DriveUploadNotice,
  DriveUploadSpaceCheck,
  DriveUploadTargetFolder,
} from "@/lib/offline/drive/upload/drive-upload-schema";

/**
 * `paused_server_full` (#1520): a file hit a full server (507 or `overQuota`),
 * so no other file starts until *Retry* (`resumeUploadQueue`) or until
 * `Quota/get` reports room for it in its target root.
 */
export type DriveUploadQueueState = "idle" | "running" | "paused_offline" | "paused_server_full";

export type DriveUploadItemView = {
  id: string;
  batchId: string;
  name: string;
  targetFolder: DriveUploadTargetFolder;
  status: DriveUploadItemStatus;
  bytesDone: number;
  bytesTotal: number;
  /** False for a direct upload that will not survive going offline or a reload. */
  localCopy: boolean;
  createdAt: number;
  /** Cache path of the target folder (where the placeholder sits), when known here. */
  folderPath?: string;
  /** The server is putting the parts together (#1519). */
  phase?: "assembling";
  /** Octets put together so far while `phase` is `assembling` (of `bytesTotal`). */
  assembledBytes?: number;
  /** False for `no_local_copy`, `insecure_context`, and `quota` without a local copy. */
  canRetry: boolean;
  error?: DriveUploadItemError;
};

/**
 * A folder of a folder upload (#1620). `waiting`: not created yet;
 * `creating`: the create is in flight; `created`: it exists and its items
 * upload into it; `failed`: it could not be created (its items failed with
 * it). The totals were stored when it was queued; `bytesDone` and
 * `filesDone` count what is no longer in the queue, plus parts already sent.
 */
export type DriveUploadFolderView = {
  id: string;
  batchId: string;
  /** Planned name, or the final name once created. */
  name: string;
  /** The folder's own name on the device. */
  sourceName: string;
  status: "waiting" | "creating" | "created" | "failed";
  targetFolder: DriveUploadTargetFolder;
  /** The folder item it sits in; unset at the top of the upload. */
  inFolder?: string;
  /** Cache path of the folder it sits in, when known here. */
  folderPath?: string;
  nodeId?: string;
  subtreeBytes: number;
  subtreeFiles: number;
  bytesDone: number;
  filesDone: number;
  /** Files below it that failed. */
  failedFiles: number;
  canRetry: boolean;
  error?: DriveUploadItemError;
};

export type DriveUploadBatchView = {
  id: string;
  status: DriveUploadBatchStatus;
  keepOffline: DriveUploadKeepOffline;
  notices: DriveUploadNotice[];
  /** The space pre-check when the batch was added (#1520). */
  spaceCheck?: DriveUploadSpaceCheck;
};

export type DriveUploadQueueSnapshot = {
  state: DriveUploadQueueState;
  /** Files only; the folders of a folder upload are in `folders`. */
  items: DriveUploadItemView[];
  folders: DriveUploadFolderView[];
  batches: DriveUploadBatchView[];
  /** For the sign-out and leave warnings. */
  hasItems: boolean;
  /** Sum of item sizes, read from the rows, never from file contents. */
  totalBytes: number;
};

export function emptyDriveUploadQueueSnapshot(): DriveUploadQueueSnapshot {
  return { state: "idle", items: [], folders: [], batches: [], hasItems: false, totalBytes: 0 };
}

export function buildDriveUploadQueueSnapshot(
  rows: DriveUploadQueueRows,
  online: boolean,
): DriveUploadQueueSnapshot {
  const released = new Set(rows.batches.filter((b) => b.status === "released").map((b) => b.id));
  const waiting = rows.items.some(
    (item) =>
      item.status !== "failed" && released.has(item.batchId) && !isCreatedUploadFolder(item),
  );
  const state: DriveUploadQueueState = isDriveUploadQueuePausedServerFull(rows.items)
    ? "paused_server_full"
    : !waiting
      ? "idle"
      : online
        ? "running"
        : "paused_offline";
  return {
    state,
    items: rows.items
      .filter((item) => item.kind !== "folder")
      .map((item) => ({
        id: item.id,
        batchId: item.batchId,
        name: item.name,
        targetFolder: item.targetFolder,
        status: item.status,
        bytesDone: item.bytesDone,
        bytesTotal: item.size,
        localCopy: item.localCopy,
        createdAt: item.createdAt,
        ...(rows.folderPaths?.has(item.id) ? { folderPath: rows.folderPaths.get(item.id) } : {}),
        ...(item.phase ? { phase: item.phase } : {}),
        ...(item.phase && item.assembledBytes !== undefined
          ? { assembledBytes: item.assembledBytes }
          : {}),
        canRetry: canRetryDriveUpload(item),
        ...(item.error ? { error: item.error } : {}),
      })),
    folders: rows.items
      .filter((item) => item.kind === "folder")
      .map((folder) => buildDriveUploadFolderView(folder, rows)),
    batches: rows.batches.map((batch) => ({
      id: batch.id,
      status: batch.status,
      keepOffline: batch.keepOffline,
      notices: batch.notices,
      ...(batch.spaceCheck ? { spaceCheck: batch.spaceCheck } : {}),
    })),
    hasItems: rows.items.length > 0,
    totalBytes: rows.items.reduce((sum, item) => sum + item.size, 0),
  };
}

function folderStatus(folder: OfflineDriveUploadItemRow): DriveUploadFolderView["status"] {
  if (isCreatedUploadFolder(folder)) return "created";
  if (folder.status === "failed") return "failed";
  return folder.status === "uploading" ? "creating" : "waiting";
}

function buildDriveUploadFolderView(
  folder: OfflineDriveUploadItemRow,
  rows: DriveUploadQueueRows,
): DriveUploadFolderView {
  const below = driveUploadSubtreeIds(rows.items, folder.id);
  const files = rows.items.filter((item) => below.has(item.id) && item.kind !== "folder");
  const subtreeBytes = folder.subtreeBytes ?? 0;
  const subtreeFiles = folder.subtreeFiles ?? 0;
  const leftBytes = files.reduce((sum, item) => sum + item.size - item.bytesDone, 0);
  return {
    id: folder.id,
    batchId: folder.batchId,
    name: folder.name,
    sourceName: folder.sourceName ?? folder.name,
    status: folderStatus(folder),
    targetFolder: folder.targetFolder,
    ...(folder.inFolder ? { inFolder: folder.inFolder } : {}),
    ...(rows.folderPaths?.has(folder.id) ? { folderPath: rows.folderPaths.get(folder.id) } : {}),
    ...(folder.createdNodeId ? { nodeId: folder.createdNodeId } : {}),
    subtreeBytes,
    subtreeFiles,
    bytesDone: Math.max(0, subtreeBytes - leftBytes),
    filesDone: Math.max(0, subtreeFiles - files.length),
    failedFiles: files.filter((item) => item.status === "failed").length,
    canRetry: canRetryDriveUpload(folder),
    ...(folder.error ? { error: folder.error } : {}),
  };
}

export async function readDriveUploadQueueSnapshot(
  username: string,
): Promise<DriveUploadQueueSnapshot> {
  return buildDriveUploadQueueSnapshot(
    await readDriveUploadQueueRows(username),
    readBrowserOnline(),
  );
}

/**
 * Every item across folders, the queue state, batch status, and notices, in
 * every open tab (not only the tab that uploads). Calls `listener` with the
 * current snapshot, then after every change in any tab and on reconnect.
 */
export function subscribeDriveUploadQueue(
  username: string,
  listener: (snapshot: DriveUploadQueueSnapshot) => void,
): () => void {
  let closed = false;
  let reading = false;
  let again = false;

  const refresh = async () => {
    if (closed) return;
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    try {
      do {
        again = false;
        const snapshot = await readDriveUploadQueueSnapshot(username);
        if (!closed) listener(snapshot);
      } while (again && !closed);
    } catch (error) {
      console.warn("[drive-upload] queue read failed", error);
    } finally {
      reading = false;
    }
  };

  const stopChanges = onDriveUploadQueueChanged(username, () => void refresh());
  const onConnectivity = () => void refresh();
  if (typeof window !== "undefined") {
    window.addEventListener("online", onConnectivity);
    window.addEventListener("offline", onConnectivity);
  }
  void refresh();

  return () => {
    closed = true;
    stopChanges();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onConnectivity);
      window.removeEventListener("offline", onConnectivity);
    }
  };
}
