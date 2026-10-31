import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import {
  isQuotaExceededError,
  planLocalCopies,
  requestPersistentStorageOnce,
} from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { notifyDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import {
  forgetUploadInMemory,
  keepUploadInMemory,
  uploadMemoryTabId,
} from "@/lib/offline/drive/upload/drive-upload-memory";
import {
  buildUploadPlaceholderRows,
  setUploadPlaceholderStatus,
} from "@/lib/offline/drive/upload/drive-upload-placeholders";
import {
  driveUploadBatchesTable,
  driveUploadBlobsTable,
  driveUploadItemsTable,
  type DriveUploadItemError,
  type DriveUploadKeepOffline,
  type DriveUploadNotice,
  type DriveUploadTargetFolder,
  type OfflineDriveUploadBatchRow,
  type OfflineDriveUploadItemRow,
} from "@/lib/offline/drive/upload/drive-upload-schema";

/** Transient failures in a row before an item fails for good. */
export const DRIVE_UPLOAD_MAX_TRANSIENT_FAILURES = 5;

function accountDb(username: string) {
  return offlineDbForAccount(offlineAccountKeyFromUsername(username));
}

function tables(username: string) {
  const db = accountDb(username);
  return {
    db,
    batches: driveUploadBatchesTable(db),
    items: driveUploadItemsTable(db),
    blobs: driveUploadBlobsTable(db),
    entries: driveEntriesTable(db),
  };
}

export type EnqueueDriveUploadsInput = {
  /** Cache path of the target folder, where placeholders appear. */
  folderPath: string;
  targetFolder: DriveUploadTargetFolder;
  files: readonly File[];
  /**
   * Tell the queue watchers about the new batch. Off for a caller that releases
   * the batch right away: the release notifies, so no read sees the batch as
   * `awaiting_input` ("Waiting for your answer") when no dialog is open.
   */
  notify?: boolean;
};

export type EnqueuedDriveUploadBatch = {
  batchId: string;
  itemIds: string[];
};

/**
 * Store a pick or drop right away, before any dialog: one batch in
 * `awaiting_input`, one item per file with its `Blob`, and one placeholder
 * row per file. A file the device has no room for is kept in this tab's
 * memory instead; a file the device refuses to store fails as `quota`.
 */
export async function enqueueDriveUploadBatch(
  username: string,
  input: EnqueueDriveUploadsInput,
): Promise<EnqueuedDriveUploadBatch> {
  await requestPersistentStorageOnce();
  const localPlan = await planLocalCopies(input.files.map((file) => file.size));
  const { db, batches } = tables(username);
  const now = Date.now();
  const batch: OfflineDriveUploadBatchRow = {
    id: crypto.randomUUID(),
    status: "awaiting_input",
    keepOffline: "remove",
    targetFolder: input.targetFolder,
    createdAt: now,
    notices: [],
  };
  await batches.put(batch);
  const itemIds: string[] = [];
  for (const [index, file] of input.files.entries()) {
    const item = newItem(batch, file, now + index, localPlan[index] ?? true);
    await storeItem(username, db, input.folderPath, item, file);
    itemIds.push(item.id);
  }
  if (input.notify !== false) notifyDriveUploadQueueChanged(username);
  return { batchId: batch.id, itemIds };
}

function newItem(
  batch: OfflineDriveUploadBatchRow,
  file: File,
  createdAt: number,
  localCopy: boolean,
): OfflineDriveUploadItemRow {
  return {
    id: crypto.randomUUID(),
    batchId: batch.id,
    targetFolder: batch.targetFolder,
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    status: "queued",
    bytesDone: 0,
    createdAt,
    localCopy,
    ...(localCopy ? {} : { memoryOwner: uploadMemoryTabId() }),
    transientFailures: 0,
  };
}

async function storeItem(
  username: string,
  db: ReturnType<typeof accountDb>,
  folderPath: string,
  item: OfflineDriveUploadItemRow,
  file: File,
): Promise<void> {
  const { items, blobs, entries } = tables(username);
  const [placeholder] = buildUploadPlaceholderRows(folderPath, [item]);
  try {
    await db.transaction("rw", items, blobs, entries, async () => {
      await items.put(item);
      if (item.localCopy) await blobs.put({ id: item.id, blob: file });
      await entries.put(placeholder!);
    });
    if (!item.localCopy) keepUploadInMemory(item.id, file);
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    const failed: OfflineDriveUploadItemRow = {
      ...item,
      localCopy: false,
      status: "failed",
      error: { code: "quota", message: "This device has no room left for this file." },
    };
    const [failedPlaceholder] = buildUploadPlaceholderRows(folderPath, [failed]);
    await db.transaction("rw", items, entries, async () => {
      await items.put(failed);
      await entries.put(failedPlaceholder!);
    });
  }
}

/** Hand a batch to the uploader with the dialog's answers. */
export async function releaseDriveUploadBatch(
  username: string,
  batchId: string,
  answers: { keepOffline: DriveUploadKeepOffline },
): Promise<void> {
  const { batches } = tables(username);
  const updated = await batches.update(batchId, {
    status: "released",
    keepOffline: answers.keepOffline,
  });
  if (updated) notifyDriveUploadQueueChanged(username);
}

/** *Cancel* in the batch dialog: drop the batch, its placeholders, and its `Blob`s. */
export async function cancelDriveUploadBatch(username: string, batchId: string): Promise<void> {
  const { db, batches, items, blobs, entries } = tables(username);
  const itemIds = await items.where("batchId").equals(batchId).primaryKeys();
  await db.transaction("rw", batches, items, blobs, entries, async () => {
    await items.bulkDelete(itemIds);
    await blobs.bulkDelete(itemIds);
    for (const itemId of itemIds) await entries.where("uploadId").equals(itemId).delete();
    await batches.delete(batchId);
  });
  for (const itemId of itemIds) forgetUploadInMemory(itemId);
  notifyDriveUploadQueueChanged(username);
}

/**
 * Remove a `queued` or `failed` item with its `Blob` and placeholder.
 * Returns false for an item that is uploading right now or already gone.
 */
export async function removeDriveUploadItem(username: string, itemId: string): Promise<boolean> {
  const { db, batches, items, blobs, entries } = tables(username);
  const removed = await db.transaction("rw", batches, items, blobs, entries, async () => {
    const item = await items.get(itemId);
    if (!item || item.status === "uploading") return false;
    await dropItemRows(username, item);
    return true;
  });
  if (removed) {
    forgetUploadInMemory(itemId);
    notifyDriveUploadQueueChanged(username);
  }
  return removed;
}

/**
 * Whether *Retry* can work for a failed item. The bytes of a `no_local_copy`
 * item are gone, and a `quota` item never reached the device: both have to be
 * added again.
 */
export function canRetryDriveUpload(item: Pick<OfflineDriveUploadItemRow, "status" | "error">) {
  if (item.status !== "failed") return false;
  return item.error?.code !== "no_local_copy" && item.error?.code !== "quota";
}

/**
 * *Retry* on a failed item: back to `queued` with a clean slate, so the
 * uploader picks it up again. False when the item is gone or cannot be retried.
 */
export async function retryDriveUploadItem(username: string, itemId: string): Promise<boolean> {
  const retried = await requeueFailedItems(username, [itemId]);
  return retried > 0;
}

/** *Retry all failed* in the Uploads view. Returns how many items went back to the queue. */
export async function retryAllFailedDriveUploads(username: string): Promise<number> {
  const failedIds = await tables(username).items.where("status").equals("failed").primaryKeys();
  return requeueFailedItems(username, failedIds);
}

async function requeueFailedItems(username: string, itemIds: readonly string[]): Promise<number> {
  const { db, items, entries } = tables(username);
  const retried = await db.transaction("rw", items, entries, async () => {
    let count = 0;
    for (const itemId of itemIds) {
      const item = await items.get(itemId);
      if (!item || !canRetryDriveUpload(item)) continue;
      const { error: _error, retryAt: _retryAt, phase: _phase, ...rest } = item;
      await items.put({ ...rest, status: "queued", bytesDone: 0, transientFailures: 0 });
      await setUploadPlaceholderStatus(username, itemId, "queued");
      count += 1;
    }
    return count;
  });
  if (retried > 0) notifyDriveUploadQueueChanged(username);
  return retried;
}

/** Inside a transaction over batches, items, blobs, and entries. */
export async function dropItemRows(
  username: string,
  item: Pick<OfflineDriveUploadItemRow, "id" | "batchId">,
): Promise<void> {
  const { batches, items, blobs, entries } = tables(username);
  await items.delete(item.id);
  await blobs.delete(item.id);
  await entries.where("uploadId").equals(item.id).delete();
  await dropBatchIfDone(batches, items, item.batchId);
}

async function dropBatchIfDone(
  batches: ReturnType<typeof tables>["batches"],
  items: ReturnType<typeof tables>["items"],
  batchId: string,
): Promise<void> {
  const remaining = await items.where("batchId").equals(batchId).count();
  if (remaining > 0) return;
  const batch = await batches.get(batchId);
  if (batch && batch.notices.length === 0) await batches.delete(batchId);
}

export async function addDriveUploadBatchNotice(
  username: string,
  batchId: string,
  notice: DriveUploadNotice,
): Promise<void> {
  const { db, batches } = tables(username);
  await db.transaction("rw", batches, async () => {
    const batch = await batches.get(batchId);
    if (!batch) return;
    await batches.put({ ...batch, notices: [...batch.notices, notice] });
  });
  notifyDriveUploadQueueChanged(username);
}

/** The user has seen the notices; a batch without items then goes away. */
export async function dismissDriveUploadBatchNotices(
  username: string,
  batchId: string,
): Promise<void> {
  const { db, batches, items } = tables(username);
  await db.transaction("rw", batches, items, async () => {
    const batch = await batches.get(batchId);
    if (!batch) return;
    await batches.put({ ...batch, notices: [] });
    await dropBatchIfDone(batches, items, batchId);
  });
  notifyDriveUploadQueueChanged(username);
}

export type DriveUploadQueueRows = {
  batches: OfflineDriveUploadBatchRow[];
  items: OfflineDriveUploadItemRow[];
  /** Cache path of the folder each item's placeholder sits in, by item id. */
  folderPaths?: ReadonlyMap<string, string>;
};

export async function readDriveUploadQueueRows(username: string): Promise<DriveUploadQueueRows> {
  const { db, batches, items, entries } = tables(username);
  return db.transaction("r", batches, items, entries, async () => {
    const placeholders = await entries.where("uploadId").above("").toArray();
    return {
      batches: await batches.orderBy("createdAt").toArray(),
      items: await items.orderBy("createdAt").toArray(),
      folderPaths: new Map(placeholders.map((row) => [row.uploadId!, row.parentPath])),
    };
  });
}

/** For the sign-out and leave warnings. */
export async function hasPendingDriveUploads(username: string): Promise<boolean> {
  return (await tables(username).items.count()) > 0;
}

export async function readDriveUploadBlob(username: string, itemId: string): Promise<Blob | null> {
  const row = await tables(username).blobs.get(itemId);
  return row?.blob ?? null;
}

/**
 * Items the uploader may start, oldest first: `queued`, or `uploading` left
 * behind by a tab that closed mid-upload (only the lock holder uploads, so
 * any `uploading` item it finds is stale), in a released batch, with a server
 * target folder.
 */
export async function listStartableDriveUploads(
  username: string,
): Promise<OfflineDriveUploadItemRow[]> {
  const { batches, items } = await readDriveUploadQueueRows(username);
  const released = new Set(batches.filter((b) => b.status === "released").map((b) => b.id));
  const now = Date.now();
  return items.filter(
    (item) =>
      item.status !== "failed" &&
      released.has(item.batchId) &&
      item.targetFolder.kind === "server" &&
      !(item.retryAt && item.retryAt > now),
  );
}

/** Mark one item `uploading`. False when it was removed or changed meanwhile. */
export async function markDriveUploadStarted(username: string, itemId: string): Promise<boolean> {
  const { db, items, entries } = tables(username);
  const started = await db.transaction("rw", items, entries, async () => {
    const item = await items.get(itemId);
    if (!item || item.status === "failed") return false;
    await items.put({ ...item, status: "uploading", bytesDone: 0 });
    await setUploadPlaceholderStatus(username, itemId, "uploading");
    return true;
  });
  if (started) notifyDriveUploadQueueChanged(username);
  return started;
}

/** Remember the node the server created, so a retry never creates a second one. */
export async function recordDriveUploadCreated(
  username: string,
  itemId: string,
  nodeId: string,
): Promise<void> {
  const { items } = tables(username);
  await items.update(itemId, { createdNodeId: nodeId });
}

/** Back to `queued` after a hiccup; fails the item after too many in a row. */
export async function requeueDriveUpload(
  username: string,
  itemId: string,
  options: { countFailure: boolean; message?: string; retryAt?: number },
): Promise<void> {
  const { db, items, entries } = tables(username);
  await db.transaction("rw", items, entries, async () => {
    const item = await items.get(itemId);
    if (!item) return;
    const transientFailures = item.transientFailures + (options.countFailure ? 1 : 0);
    if (transientFailures >= DRIVE_UPLOAD_MAX_TRANSIENT_FAILURES) {
      const message = options.message ?? "The upload kept failing.";
      const error = failure(message);
      await items.put({ ...item, status: "failed", transientFailures, error });
      await setUploadPlaceholderStatus(username, itemId, "failed", error.code);
      return;
    }
    const { retryAt: _previous, ...rest } = item;
    await items.put({
      ...rest,
      status: "queued",
      bytesDone: 0,
      transientFailures,
      ...(options.retryAt ? { retryAt: options.retryAt } : {}),
    });
    await setUploadPlaceholderStatus(username, itemId, "queued");
  });
  notifyDriveUploadQueueChanged(username);
}

function failure(message: string): DriveUploadItemError {
  return { code: "upload_failed", message };
}

export async function failDriveUpload(
  username: string,
  itemId: string,
  error: DriveUploadItemError,
): Promise<void> {
  const { db, items, entries } = tables(username);
  await db.transaction("rw", items, entries, async () => {
    const item = await items.get(itemId);
    if (!item) return;
    // The `Blob` stays: a failed item keeps its bytes until it is retried or removed.
    await items.put({ ...item, status: "failed", bytesDone: 0, error });
    await setUploadPlaceholderStatus(username, itemId, "failed", error.code);
  });
  notifyDriveUploadQueueChanged(username);
}

export async function readDriveUploadBatch(
  username: string,
  batchId: string,
): Promise<OfflineDriveUploadBatchRow | undefined> {
  return tables(username).batches.get(batchId);
}
