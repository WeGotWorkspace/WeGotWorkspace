import { fileNodeToDirectoryEntry } from "@/lib/api/wgw/drive-jmap";
import type { JmapFileNode } from "@/lib/jmap-client";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { driveEntryRowFromEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import { notifyDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import {
  joinDrivePath,
  moveUploadFolderRows,
  withUploadMarker,
} from "@/lib/offline/drive/upload/drive-upload-folder-placeholders";
import {
  driveUploadAncestorIds,
  driveUploadSubtreeIds,
  isCreatedUploadFolder,
} from "@/lib/offline/drive/upload/drive-upload-folder-rows";
import { forgetUploadInMemory } from "@/lib/offline/drive/upload/drive-upload-memory";
import {
  findUploadPlaceholder,
  setUploadPlaceholderStatus,
} from "@/lib/offline/drive/upload/drive-upload-placeholders";
import {
  driveUploadBatchesTable,
  driveUploadBlobsTable,
  driveUploadItemsTable,
  type DriveUploadPlacing,
  type OfflineDriveUploadItemRow,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import {
  dropDriveUploadBatchIfDone,
  dropItemRows,
  removeDriveUploadItem,
  requeueFailedItems,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { cachedDriveFolderPath } from "@/lib/offline/drive/upload/drive-upload-target";

function tables(username: string) {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return {
    db,
    batches: driveUploadBatchesTable(db),
    items: driveUploadItemsTable(db),
    blobs: driveUploadBlobsTable(db),
    entries: driveEntriesTable(db),
  };
}

/** Store (or clear) the folder create about to be sent, and its id once known. */
export async function recordDriveUploadFolderPlacing(
  username: string,
  itemId: string,
  placing: DriveUploadPlacing | null,
): Promise<void> {
  await tables(username).items.update(itemId, { placing: placing ?? undefined });
}

/**
 * Cache path a folder item sits in: its row's folder, else the folder its
 * target id is known under here.
 */
export async function driveUploadFolderParentPath(
  username: string,
  item: OfflineDriveUploadItemRow,
): Promise<string | null> {
  const row = await findUploadPlaceholder(username, item.id);
  if (row) return row.parentPath;
  if (item.targetFolder.kind !== "server") return null;
  return cachedDriveFolderPath(username, item.targetFolder.id);
}

/**
 * The server has the folder: in one transaction, the folder item records the
 * node and its final name, every item that waited for it targets the node,
 * its row becomes the real folder (still marked as uploading) and moves with
 * its placeholders when the folder got another name, with a `kept_both`
 * notice. A batch with nothing left to upload is done.
 */
export async function resolveDriveUploadFolder(
  username: string,
  itemId: string,
  node: JmapFileNode,
): Promise<void> {
  const { db, batches, items, entries } = tables(username);
  await db.transaction("rw", batches, items, entries, async () => {
    const item = await items.get(itemId);
    if (!item || item.kind !== "folder") return;
    const batchItems = await items.where("batchId").equals(item.batchId).toArray();
    for (const waiting of batchItems) {
      if (waiting.targetFolder.kind !== "temporary" || waiting.targetFolder.id !== item.id)
        continue;
      await items.put({ ...waiting, targetFolder: { kind: "server", id: node.id } });
    }
    const { placing: _placing, ...rest } = item;
    const created: OfflineDriveUploadItemRow = { ...rest, name: node.name, createdNodeId: node.id };
    await items.put(created);
    const parentPath = await driveUploadFolderParentPath(username, item);
    if (parentPath !== null) {
      const row = await findUploadPlaceholder(username, item.id);
      const path = joinDrivePath(parentPath, node.name);
      const byId = new Map(batchItems.map((candidate) => [candidate.id, candidate]));
      byId.set(item.id, created);
      await moveUploadFolderRows(
        username,
        byId,
        row?.id ?? joinDrivePath(parentPath, item.name),
        path,
      );
      const entry = fileNodeToDirectoryEntry(`/${path}`, node);
      await entries.put(withUploadMarker(driveEntryRowFromEntry(entry), created, entry));
    }
    if (node.name.toLowerCase() !== item.name.toLowerCase()) {
      const batch = await batches.get(item.batchId);
      const notice = {
        type: "kept_both" as const,
        itemName: item.sourceName ?? item.name,
        keptAsName: node.name,
      };
      if (batch) await batches.put({ ...batch, notices: [...batch.notices, notice] });
    }
    await dropDriveUploadBatchIfDone(username, item.batchId);
  });
  notifyDriveUploadQueueChanged(username);
}

/**
 * A folder that ended `failed` takes everything below it along, with the
 * same reason: none of it can upload before the folder exists.
 */
export async function failDriveUploadFolderDescendants(
  username: string,
  folderId: string,
): Promise<void> {
  const { db, items, entries } = tables(username);
  const failed = await db.transaction("rw", items, entries, async () => {
    const folder = await items.get(folderId);
    if (folder?.status !== "failed" || !folder.error) return false;
    const batchItems = await items.where("batchId").equals(folder.batchId).toArray();
    const below = driveUploadSubtreeIds(batchItems, folderId);
    for (const item of batchItems) {
      if (!below.has(item.id) || item.status === "failed" || isCreatedUploadFolder(item)) continue;
      await items.put({ ...item, status: "failed", bytesDone: 0, error: folder.error });
      await setUploadPlaceholderStatus(username, item.id, "failed", folder.error.code);
    }
    return below.size > 0;
  });
  if (failed) notifyDriveUploadQueueChanged(username);
}

/**
 * *Retry* on an item of a folder upload: its failed parent folders go back
 * to the queue with it (it cannot upload before they exist), and on a folder
 * everything below it that failed with it. False when nothing went back.
 */
export async function retryDriveUploadTreeItem(username: string, itemId: string): Promise<boolean> {
  const { items } = tables(username);
  const item = await items.get(itemId);
  if (!item) return false;
  const batchItems = await items.where("batchId").equals(item.batchId).toArray();
  const byId = new Map(batchItems.map((candidate) => [candidate.id, candidate]));
  const failed = (id: string) => byId.get(id)?.status === "failed";
  const ids = [
    ...driveUploadAncestorIds(batchItems, item).filter(failed),
    itemId,
    ...(item.kind === "folder"
      ? [...driveUploadSubtreeIds(batchItems, itemId)].filter(failed)
      : []),
  ];
  return (await requeueFailedItems(username, ids)) > 0;
}

/**
 * *Remove* on an item of the queue. On a folder: the folder and everything
 * below it, with their files and placeholders; folders already created stay
 * on the server. False while anything in it is uploading, or once gone.
 */
export async function removeDriveUploadTreeItem(
  username: string,
  itemId: string,
): Promise<boolean> {
  const { db, batches, items, blobs, entries } = tables(username);
  const first = await items.get(itemId);
  if (first?.kind !== "folder") return removeDriveUploadItem(username, itemId);
  const removed = await db.transaction("rw", batches, items, blobs, entries, async () => {
    const folder = await items.get(itemId);
    if (!folder) return null;
    const batchItems = await items.where("batchId").equals(folder.batchId).toArray();
    const subtree = new Set([itemId, ...driveUploadSubtreeIds(batchItems, itemId)]);
    const inSubtree = batchItems.filter((item) => subtree.has(item.id));
    const busy = inSubtree.some(
      (item) => item.status === "uploading" && !isCreatedUploadFolder(item),
    );
    if (busy) return null;
    for (const item of inSubtree) await dropItemRows(username, item);
    return inSubtree.map((item) => item.id);
  });
  if (!removed) return false;
  for (const id of removed) forgetUploadInMemory(id);
  notifyDriveUploadQueueChanged(username);
  return true;
}
