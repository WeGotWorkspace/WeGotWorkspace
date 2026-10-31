import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { onDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import {
  readDriveUploadQueueRows,
  type DriveUploadQueueRows,
} from "@/lib/offline/drive/upload/drive-upload-store";
import type {
  DriveUploadBatchStatus,
  DriveUploadItemError,
  DriveUploadItemStatus,
  DriveUploadKeepOffline,
  DriveUploadNotice,
  DriveUploadTargetFolder,
} from "@/lib/offline/drive/upload/drive-upload-schema";

/** `paused_server_full` is set by #1520; this slice never enters it. */
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
  error?: DriveUploadItemError;
};

export type DriveUploadBatchView = {
  id: string;
  status: DriveUploadBatchStatus;
  keepOffline: DriveUploadKeepOffline;
  notices: DriveUploadNotice[];
};

export type DriveUploadQueueSnapshot = {
  state: DriveUploadQueueState;
  items: DriveUploadItemView[];
  batches: DriveUploadBatchView[];
  /** For the sign-out and leave warnings. */
  hasItems: boolean;
  /** Sum of item sizes, read from the rows, never from file contents. */
  totalBytes: number;
};

export function emptyDriveUploadQueueSnapshot(): DriveUploadQueueSnapshot {
  return { state: "idle", items: [], batches: [], hasItems: false, totalBytes: 0 };
}

export function buildDriveUploadQueueSnapshot(
  rows: DriveUploadQueueRows,
  online: boolean,
): DriveUploadQueueSnapshot {
  const released = new Set(rows.batches.filter((b) => b.status === "released").map((b) => b.id));
  const waiting = rows.items.some((item) => item.status !== "failed" && released.has(item.batchId));
  const state: DriveUploadQueueState = !waiting ? "idle" : online ? "running" : "paused_offline";
  return {
    state,
    items: rows.items.map((item) => ({
      id: item.id,
      batchId: item.batchId,
      name: item.name,
      targetFolder: item.targetFolder,
      status: item.status,
      bytesDone: item.bytesDone,
      bytesTotal: item.size,
      localCopy: item.localCopy,
      ...(item.error ? { error: item.error } : {}),
    })),
    batches: rows.batches.map((batch) => ({
      id: batch.id,
      status: batch.status,
      keepOffline: batch.keepOffline,
      notices: batch.notices,
    })),
    hasItems: rows.items.length > 0,
    totalBytes: rows.items.reduce((sum, item) => sum + item.size, 0),
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
