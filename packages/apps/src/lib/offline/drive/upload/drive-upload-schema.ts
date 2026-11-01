import type { EntityTable } from "dexie";
import type { WgwDriveUploadErrorCode } from "@/lib/api/wgw/types";
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

/**
 * Per-batch notices, kept until the user has seen them (also after the item
 * finished). `replace_fell_back`: *Replace* found the file changed and kept
 * both instead. `kept_both`: a name conflict found at upload time in a batch
 * without a stored choice was resolved as keep both. Both name the existing
 * file (`itemName`) and the name the upload got (`keptAsName`).
 */
export type DriveUploadNotice =
  | { type: "offline_copy_failed"; itemName: string; reason: "quota" }
  | { type: "replace_fell_back"; itemName: string; keptAsName: string }
  | { type: "kept_both"; itemName: string; keptAsName: string };

/**
 * The space pre-check of a batch (#1520), stored when the batch is added so
 * the batch dialog (#1521) can show it. `unknown` (no quota for the target
 * root, or none known on this device) shows no warning. Otherwise it compares
 * `neededBytes` (the batch plus what is still left in the queue for the same
 * root) with `freeBytes` (`hardLimit − used` of that root's quota).
 * `fresh` is false when the quota came from the last known value (offline or
 * the server did not answer); `measuredAt` tells its age.
 */
export type DriveUploadSpaceCheck =
  | { status: "unknown" }
  | {
      status: "fits" | "does_not_fit";
      /** Quota id, `dq-{rootNodeId}`. */
      quotaId: string;
      batchBytes: number;
      /** Bytes still to send for other queued files in the same root. */
      queuedBytes: number;
      neededBytes: number;
      freeBytes: number;
      /** When the server reported this free space (ms). */
      measuredAt: number;
      fresh: boolean;
    };

/** The user's answer for names that already exist in the target folder. */
export type DriveUploadConflictChoice = "replace" | "keep_both" | "skip";

/**
 * The existing file as the user saw it when choosing *Replace* (from the
 * listing the question was based on). The upload updates this node's
 * `blobId` with `expectedBlobId` = `blobId`.
 */
export type DriveUploadReplaceTarget = { nodeId: string; blobId: string };

/** One pick or drop. */
export type OfflineDriveUploadBatchRow = {
  id: string;
  status: DriveUploadBatchStatus;
  keepOffline: DriveUploadKeepOffline;
  targetFolder: DriveUploadTargetFolder;
  createdAt: number;
  /** Kept after the items finish, until the user has seen them. */
  notices: DriveUploadNotice[];
  /**
   * The conflict answer. Unset when the batch had no conflicts when it was
   * queued: a conflict found at upload time is then kept both, with a notice.
   */
  conflict?: DriveUploadConflictChoice;
  /** The space pre-check when the batch was added (#1520). */
  spaceCheck?: DriveUploadSpaceCheck;
};

export type DriveUploadItemStatus = "queued" | "uploading" | "failed";

export type DriveUploadErrorCode = WgwDriveUploadErrorCode;

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
  /**
   * After a hiccup, no tab starts this item again before this time (ms). On a
   * failed `server_full` item: no tab asks the server for free space before it.
   */
  retryAt?: number;
  /**
   * Id of the node the server created for this item. Once set, a retry only
   * reads that node back and finishes; it never uploads or creates again.
   */
  createdNodeId?: string;
  /**
   * Set by the chunked uploader (#1519) once every part is sent and the
   * server is putting the file together. Unset during a whole-file upload.
   */
  phase?: "assembling";
  /** Octets the server has put together so far, while `phase` is `assembling`. */
  assembledBytes?: number;
  /** Parts, assembly id, and steps done; survives a reload. */
  chunk?: DriveUploadChunkState;
  /** *Replace* only: the existing file as the user saw it when choosing. */
  replaceTarget?: DriveUploadReplaceTarget;
  error?: DriveUploadItemError;
};

/** One part on the server, in file order. */
export type DriveUploadPart = { offset: number; length: number; blobId: string };

/**
 * Progress of a chunked upload (#1519), stored after every part and every
 * assembly step so a reload or reconnect resumes from the next one.
 */
export type DriveUploadChunkState = {
  /** Working part size for this file (halved when a host refuses a part). */
  partSize: number;
  /** Parts the server has, in file order. */
  parts: DriveUploadPart[];
  /** How the parts become one blob; unset while the file fits in one part. */
  join?: "assembly" | "blob_upload";
  assemblyId?: string;
  /** Parts the assembly has accepted (its `nextIndex`); never sent again. */
  appendedParts: number;
  /** Most parts per append call, after a `limit` on a step. */
  stepParts?: number;
  /** The file's blob: its only part, the joined blob, or the finished assembly. */
  blobId?: string;
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
