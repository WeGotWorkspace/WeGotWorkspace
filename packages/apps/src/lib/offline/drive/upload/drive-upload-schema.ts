import type { EntityTable } from "dexie";
import type { WgwOfflineDatabase } from "@/lib/offline/core/offline-db";

/**
 * Upload queue tables. Registered by `drive-schema.ts` in the drive Dexie
 * block. The queue is keyed by target folder id; `drive_entries` stays keyed
 * by path and holds one placeholder row per item.
 */
export const DRIVE_UPLOAD_STORES = {
  drive_upload_batches: "id, createdAt",
  drive_upload_items: "id, batchId, status, createdAt",
  drive_upload_blobs: "id",
} as const;

/**
 * Target folder of a queued file. This Epic only writes `server` ids. Folder
 * upload (#1040) adds `temporary` ids for folders it has not created yet; the
 * uploader skips those until they resolve.
 */
export type DriveUploadTargetFolder =
  { kind: "server"; id: string } | { kind: "temporary"; id: string };

/** What happens to files the device offline rule would not keep on its own. */
export type DriveUploadKeepOffline = "remove" | "keep";

export type DriveUploadBatchStatus = "awaiting_input" | "released";

/** Per-batch notices. #1519 adds the conflict notices (`replace_fell_back`, keep-both). */
export type DriveUploadNotice = { type: "offline_copy_failed"; itemName: string; reason: "quota" };

/** One pick or drop. */
export type OfflineDriveUploadBatchRow = {
  id: string;
  status: DriveUploadBatchStatus;
  keepOffline: DriveUploadKeepOffline;
  targetFolder: DriveUploadTargetFolder;
  createdAt: number;
  /** Kept after the items finish, until the user has seen them. */
  notices: DriveUploadNotice[];
};

export type DriveUploadItemStatus = "queued" | "uploading" | "failed";

/**
 * `too_large`: over the server's `maxSizeUpload` (or a 413). `quota`: the
 * device refused to store the file. `no_local_copy`: a direct upload whose
 * bytes are gone after a reload. `upload_failed`: anything else that will not
 * succeed by retrying. #1520 refines these classes.
 */
export type DriveUploadErrorCode = "too_large" | "quota" | "no_local_copy" | "upload_failed";

export type DriveUploadItemError = { code: DriveUploadErrorCode; message: string };

export type OfflineDriveUploadItemRow = {
  id: string;
  batchId: string;
  targetFolder: DriveUploadTargetFolder;
  name: string;
  /** Stored so the queue total never reads file contents. */
  size: number;
  mimeType: string;
  status: DriveUploadItemStatus;
  bytesDone: number;
  createdAt: number;
  /**
   * False when the device had no room: the file uploads straight from the
   * memory of tab `memoryOwner` and does not survive a reload.
   */
  localCopy: boolean;
  memoryOwner?: string;
  /** Network or server hiccups in a row; the item fails after a few. */
  transientFailures: number;
  /** After a hiccup, no tab starts this item again before this time (ms). */
  retryAt?: number;
  error?: DriveUploadItemError;
};

export type OfflineDriveUploadBlobRow = {
  /** Same id as the item. */
  id: string;
  blob: Blob;
};

export function driveUploadBatchesTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineDriveUploadBatchRow, "id"> {
  return db.table<OfflineDriveUploadBatchRow, string>("drive_upload_batches") as EntityTable<
    OfflineDriveUploadBatchRow,
    "id"
  >;
}

export function driveUploadItemsTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineDriveUploadItemRow, "id"> {
  return db.table<OfflineDriveUploadItemRow, string>("drive_upload_items") as EntityTable<
    OfflineDriveUploadItemRow,
    "id"
  >;
}

export function driveUploadBlobsTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineDriveUploadBlobRow, "id"> {
  return db.table<OfflineDriveUploadBlobRow, string>("drive_upload_blobs") as EntityTable<
    OfflineDriveUploadBlobRow,
    "id"
  >;
}
