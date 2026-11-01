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
  type DriveUploadChunkState,
  type DriveUploadConflictChoice,
  type DriveUploadErrorCode,
  type DriveUploadItemError,
  type DriveUploadKeepOffline,
  type DriveUploadNotice,
  type DriveUploadReplaceTarget,
  type DriveUploadSpaceCheck,
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
    const item = newDriveUploadItem(batch, file, now + index, localPlan[index] ?? true);
    await storeItem(username, db, input.folderPath, item, file);
    itemIds.push(item.id);
  }
  if (input.notify !== false) notifyDriveUploadQueueChanged(username);
  return { batchId: batch.id, itemIds };
}

/** A new `queued` item of `batch` for `file`. */
export function newDriveUploadItem(
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

/** The batch dialog's answers. */
export type DriveUploadBatchReleaseAnswers = {
  keepOffline: DriveUploadKeepOffline;
  /** Only when the batch had name conflicts when it was queued. */
  conflict?: DriveUploadConflictChoice;
  /** *Replace*: per colliding item, the existing file as the user saw it. */
  replaceTargets?: Readonly<Record<string, DriveUploadReplaceTarget>>;
};

/** Hand a batch to the uploader with the dialog's answers. */
export async function releaseDriveUploadBatch(
  username: string,
  batchId: string,
  answers: DriveUploadBatchReleaseAnswers,
): Promise<void> {
  const { db, batches, items } = tables(username);
  const updated = await db.transaction("rw", batches, items, async () => {
    const count = await batches.update(batchId, {
      status: "released",
      keepOffline: answers.keepOffline,
      ...(answers.conflict ? { conflict: answers.conflict } : {}),
    });
    if (!count) return false;
    for (const [itemId, replaceTarget] of Object.entries(answers.replaceTargets ?? {})) {
      const item = await items.get(itemId);
      if (item?.batchId === batchId) await items.put({ ...item, replaceTarget });
    }
    return true;
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
 * item are gone, and a `quota` item that never reached the device has to be
 * added again too. Every other failed item keeps its `Blob` until the user
 * retries or removes it; nothing is dropped automatically.
 */
export function canRetryDriveUpload(
  item: Pick<OfflineDriveUploadItemRow, "status" | "error" | "localCopy">,
) {
  if (item.status !== "failed") return false;
  const code = item.error?.code ?? "permanent";
  if (code === "quota") return item.localCopy;
  return !NOT_RETRYABLE.has(code);
}

/**
 * Retrying cannot help: the bytes are gone (`no_local_copy`), or the page has
 * no Web Crypto for part checksums (`insecure_context`, fixed only by opening
 * the app over https).
 */
const NOT_RETRYABLE = new Set<DriveUploadErrorCode>(["no_local_copy", "insecure_context"]);

/**
 * The queue is paused because the server is full (`paused_server_full`) while
 * an item that hit a 507 or `overQuota` waits: no other file starts. *Retry*
 * on it, or `resumeDriveUploadQueue` once the server has room, lifts it.
 */
export function isDriveUploadQueuePausedServerFull(
  items: readonly Pick<OfflineDriveUploadItemRow, "status" | "error">[],
): boolean {
  return items.some((item) => item.status === "failed" && item.error?.code === "server_full");
}

/** Octets of the file the server already has as parts. */
function chunkBytes(chunk: DriveUploadChunkState | undefined): number {
  const last = chunk?.parts.at(-1);
  return last ? last.offset + last.length : 0;
}

/**
 * *Retry* on a failed item: back to `queued` with a clean slate, so the
 * uploader picks it up again. False when the item is gone or cannot be retried.
 */
export async function retryDriveUploadItem(username: string, itemId: string): Promise<boolean> {
  const retried = await requeueFailedItems(username, [itemId]);
  return retried > 0;
}

/**
 * Lift the `paused_server_full` pause: the items that hit a full server go
 * back to the queue, resuming from their stored parts. Returns how many.
 */
export async function resumeDriveUploadQueue(username: string): Promise<number> {
  const failed = await tables(username).items.where("status").equals("failed").toArray();
  const full = failed.filter((item) => item.error?.code === "server_full").map((item) => item.id);
  return requeueFailedItems(username, full);
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
      // Parts already on the server stay: a retry resumes from the next one.
      const { error: _error, retryAt: _retryAt, phase: _phase, ...rest } = item;
      await items.put({
        ...rest,
        status: "queued",
        bytesDone: chunkBytes(item.chunk),
        transientFailures: 0,
      });
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
  if (isDriveUploadQueuePausedServerFull(items)) return [];
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

/**
 * Mark one item `uploading`. Parts already on the server count as done.
 * False when it was removed or changed meanwhile.
 */
export async function markDriveUploadStarted(username: string, itemId: string): Promise<boolean> {
  const { db, items, entries } = tables(username);
  const started = await db.transaction("rw", items, entries, async () => {
    const item = await items.get(itemId);
    if (!item || item.status === "failed") return false;
    const { phase: _phase, assembledBytes: _assembled, ...rest } = item;
    await items.put({ ...rest, status: "uploading", bytesDone: chunkBytes(item.chunk) });
    await setUploadPlaceholderStatus(username, itemId, "uploading");
    return true;
  });
  if (started) notifyDriveUploadQueueChanged(username);
  return started;
}

/** Chunk progress of an item that is uploading, stored after every part and step. */
export type DriveUploadProgressRecord = {
  chunk: DriveUploadChunkState;
  bytesDone: number;
  phase?: "assembling";
  assembledBytes?: number;
};

/**
 * Store chunk progress, so a reload or reconnect resumes from the next part
 * or assembly step. Ignored for an item that is gone or no longer uploading.
 */
export async function saveDriveUploadProgress(
  username: string,
  itemId: string,
  progress: DriveUploadProgressRecord,
): Promise<void> {
  const { db, items } = tables(username);
  const saved = await db.transaction("rw", items, async () => {
    const item = await items.get(itemId);
    if (!item || item.status !== "uploading") return false;
    const { phase: _phase, assembledBytes: _assembled, ...rest } = item;
    await items.put({
      ...rest,
      chunk: progress.chunk,
      bytesDone: progress.bytesDone,
      ...(progress.phase ? { phase: progress.phase } : {}),
      ...(progress.phase && progress.assembledBytes !== undefined
        ? { assembledBytes: progress.assembledBytes }
        : {}),
    });
    return true;
  });
  if (saved) notifyDriveUploadQueueChanged(username);
}

/**
 * Remember the node the server created (or replaced), so a retry never
 * creates a second one, and store the batch notice that goes with it.
 */
export async function recordDriveUploadCreated(
  username: string,
  itemId: string,
  nodeId: string,
  notice?: DriveUploadNotice,
): Promise<void> {
  const { db, batches, items } = tables(username);
  await db.transaction("rw", batches, items, async () => {
    const item = await items.get(itemId);
    if (!item) return;
    await items.put({ ...item, createdNodeId: nodeId });
    if (!notice) return;
    const batch = await batches.get(item.batchId);
    if (batch) await batches.put({ ...batch, notices: [...batch.notices, notice] });
  });
  if (notice) notifyDriveUploadQueueChanged(username);
}

/** `skip` met a taken name: the item and its placeholder go, nothing was created. */
export async function skipDriveUploadItem(username: string, itemId: string): Promise<void> {
  const { db, batches, items, blobs, entries } = tables(username);
  await db.transaction("rw", batches, items, blobs, entries, async () => {
    const item = await items.get(itemId);
    if (item) await dropItemRows(username, item);
  });
  forgetUploadInMemory(itemId);
  notifyDriveUploadQueueChanged(username);
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
    // Stored parts and assembly steps stay: the next attempt resumes from them.
    const { retryAt: _previous, ...rest } = item;
    await items.put({
      ...rest,
      status: "queued",
      bytesDone: chunkBytes(item.chunk),
      transientFailures,
      ...(options.retryAt ? { retryAt: options.retryAt } : {}),
    });
    await setUploadPlaceholderStatus(username, itemId, "queued");
  });
  notifyDriveUploadQueueChanged(username);
}

/** Hiccups that kept coming back after every retry with backoff. */
function failure(message: string): DriveUploadItemError {
  return { code: "transient", message };
}

/**
 * Fail an item. Its `Blob` stays until it is retried or removed. Stored chunk
 * progress stays only with `keepProgress` (a full server: *Retry* resumes);
 * otherwise a retry starts the file over. `checkSpaceAt` (a full server): no
 * tab asks the server for free space for this item before then.
 */
export async function failDriveUpload(
  username: string,
  itemId: string,
  error: DriveUploadItemError,
  options: { keepProgress?: boolean; checkSpaceAt?: number } = {},
): Promise<void> {
  const { db, items, entries } = tables(username);
  await db.transaction("rw", items, entries, async () => {
    const item = await items.get(itemId);
    if (!item) return;
    const { chunk, phase: _phase, assembledBytes: _assembled, retryAt: _retryAt, ...rest } = item;
    const kept = options.keepProgress && chunk ? { chunk } : {};
    await items.put({
      ...rest,
      ...kept,
      status: "failed",
      bytesDone: options.keepProgress ? chunkBytes(chunk) : 0,
      ...(options.checkSpaceAt ? { retryAt: options.checkSpaceAt } : {}),
      error,
    });
    await setUploadPlaceholderStatus(username, itemId, "failed", error.code);
  });
  notifyDriveUploadQueueChanged(username);
}

/**
 * The server still has no room for a `server_full` item: no tab asks again
 * before `at`. The write wakes every tab's uploader, which then waits.
 */
export async function deferDriveUploadSpaceCheck(
  username: string,
  itemId: string,
  at: number,
): Promise<void> {
  const updated = await tables(username).items.update(itemId, { retryAt: at });
  if (updated) notifyDriveUploadQueueChanged(username);
}

/** Store the space pre-check on the batch, for the batch dialog (#1521). */
export async function recordDriveUploadBatchSpaceCheck(
  username: string,
  batchId: string,
  spaceCheck: DriveUploadSpaceCheck,
): Promise<void> {
  const updated = await tables(username).batches.update(batchId, { spaceCheck });
  if (updated) notifyDriveUploadQueueChanged(username);
}

/**
 * Send a queued or failed file to another folder (`target_missing`, or the
 * user picked a new one): its stored `Blob` and any parts already on the
 * server stay, its placeholder moves to the new folder, and it goes back to
 * the queue. False while it is uploading, after the server created its node,
 * or when it is gone.
 */
export async function retargetDriveUploadItem(
  username: string,
  itemId: string,
  target: { folderPath: string; targetFolder: DriveUploadTargetFolder },
): Promise<boolean> {
  const { db, items, entries } = tables(username);
  const moved = await db.transaction("rw", items, entries, async () => {
    const item = await items.get(itemId);
    if (!item || item.status === "uploading" || item.createdNodeId) return false;
    const { error: _error, retryAt: _retryAt, phase: _phase, ...rest } = item;
    const next: OfflineDriveUploadItemRow = {
      ...rest,
      targetFolder: target.targetFolder,
      status: "queued",
      bytesDone: chunkBytes(item.chunk),
      transientFailures: 0,
    };
    await items.put(next);
    await entries.where("uploadId").equals(itemId).delete();
    const [placeholder] = buildUploadPlaceholderRows(target.folderPath, [next]);
    await entries.put(placeholder!);
    return true;
  });
  if (moved) notifyDriveUploadQueueChanged(username);
  return moved;
}

export async function readDriveUploadBatch(
  username: string,
  batchId: string,
): Promise<OfflineDriveUploadBatchRow | undefined> {
  return tables(username).batches.get(batchId);
}
