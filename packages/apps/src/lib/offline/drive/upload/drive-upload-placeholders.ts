import type { DriveUIData } from "@/lib/files/drive-types";
import type {
  WgwDriveDirectoryEntry,
  WgwDriveUploadErrorCode,
  WgwDriveUploadPlaceholder,
} from "@/lib/api/wgw/types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import { driveEntriesTable, type OfflineDriveEntryRow } from "@/lib/offline/drive/drive-schema";
import {
  driveUploadItemsTable,
  type OfflineDriveUploadItemRow,
} from "@/lib/offline/drive/upload/drive-upload-schema";

/**
 * A placeholder's last path segment. A NUL byte cannot occur in a server file
 * name, so a placeholder never collides with a real row or another placeholder.
 */
const PLACEHOLDER_SEGMENT_PREFIX = "\u0000upload:";

export type DriveUploadPlaceholderStatus = WgwDriveUploadPlaceholder["status"];

function accountDb(username: string) {
  return offlineDbForAccount(offlineAccountKeyFromUsername(username));
}

export function uploadPlaceholderRowId(folderPath: string, itemId: string): string {
  const folder = normalizeOfflinePath(folderPath).replace(/\/+$/, "");
  return `${folder}/${PLACEHOLDER_SEGMENT_PREFIX}${itemId}`;
}

export function isUploadPlaceholderRow(row: Pick<OfflineDriveEntryRow, "uploadId">): boolean {
  return typeof row.uploadId === "string" && row.uploadId.length > 0;
}

function placeholderEntry(
  rowId: string,
  item: Pick<OfflineDriveUploadItemRow, "id" | "batchId" | "name" | "size" | "createdAt" | "error">,
  status: DriveUploadPlaceholderStatus,
): WgwDriveDirectoryEntry {
  return {
    type: "file",
    path: `/${rowId}`,
    name: item.name,
    size: item.size,
    time: Math.floor(item.createdAt / 1000),
    permissions: 0,
    myRights: {
      mayView: false,
      mayComment: false,
      mayReview: false,
      mayEditContent: false,
      mayManageStructure: false,
      mayShare: false,
    },
    upload: {
      id: item.id,
      batchId: item.batchId,
      status,
      ...(status === "failed" && item.error ? { reason: item.error.code } : {}),
    },
  };
}

function placeholderRow(
  folderPath: string,
  item: Pick<OfflineDriveUploadItemRow, "id" | "batchId" | "name" | "size" | "createdAt" | "error">,
  status: DriveUploadPlaceholderStatus,
): OfflineDriveEntryRow {
  const id = uploadPlaceholderRowId(folderPath, item.id);
  return {
    id,
    parentPath: normalizeOfflinePath(folderPath).replace(/\/+$/, ""),
    type: "file",
    modifiedAt: Math.floor(item.createdAt / 1000),
    data: JSON.stringify(placeholderEntry(id, item, status)),
    uploadId: item.id,
  };
}

/**
 * A folder item's placeholder: a `dir` row at the folder's real path, so it
 * can be opened while the folder waits to be created. The placeholders of its
 * items sit under that path.
 */
export function buildUploadFolderPlaceholderRow(
  folderPath: string,
  item: OfflineDriveUploadItemRow,
): OfflineDriveEntryRow {
  const parentPath = normalizeOfflinePath(folderPath).replace(/\/+$/, "");
  const id = parentPath ? `${parentPath}/${item.name}` : item.name;
  const entry = placeholderEntry(id, item, item.status);
  return {
    id,
    parentPath,
    type: "dir",
    modifiedAt: Math.floor(item.createdAt / 1000),
    data: JSON.stringify({
      ...entry,
      type: "dir",
      size: 0,
      myRights: { ...entry.myRights, mayView: true },
    }),
    uploadId: item.id,
  };
}

/** Placeholder rows to write next to their queue items. */
export function buildUploadPlaceholderRows(
  folderPath: string,
  items: readonly OfflineDriveUploadItemRow[],
): OfflineDriveEntryRow[] {
  return items.map((item) => placeholderRow(folderPath, item, item.status));
}

/** The placeholder of a queue item, wherever path migrations have moved it. */
export async function findUploadPlaceholder(
  username: string,
  itemId: string,
): Promise<OfflineDriveEntryRow | undefined> {
  return driveEntriesTable(accountDb(username)).where("uploadId").equals(itemId).first();
}

/** `reason` is kept only on a `failed` placeholder, so the row can say why. */
export async function setUploadPlaceholderStatus(
  username: string,
  itemId: string,
  status: DriveUploadPlaceholderStatus,
  reason?: WgwDriveUploadErrorCode,
): Promise<void> {
  const table = driveEntriesTable(accountDb(username));
  const row = await table.where("uploadId").equals(itemId).first();
  if (!row) return;
  const entry = JSON.parse(row.data) as WgwDriveDirectoryEntry;
  if (!entry.upload) return;
  const nextReason = status === "failed" ? reason : undefined;
  if (entry.upload.status === status && entry.upload.reason === nextReason) return;
  const { reason: _previous, ...marker } = entry.upload;
  entry.upload = { ...marker, status, ...(nextReason ? { reason: nextReason } : {}) };
  await table.put({ ...row, data: JSON.stringify(entry) });
}

/** Paths of placeholders whose queue item still exists. Prune leaves them alone. */
export async function uploadPlaceholderProtectedPaths(username: string): Promise<Set<string>> {
  const db = accountDb(username);
  const rows = await driveEntriesTable(db).where("uploadId").above("").toArray();
  if (rows.length === 0) return new Set();
  const itemIds = rows.map((row) => row.uploadId!);
  const items = await driveUploadItemsTable(db).bulkGet(itemIds);
  const paths = new Set<string>();
  rows.forEach((row, index) => {
    if (items[index]) paths.add(row.id);
  });
  return paths;
}

export async function readUploadPlaceholderEntries(
  username: string,
  folderPath: string,
): Promise<WgwDriveDirectoryEntry[]> {
  const parentPath = normalizeOfflinePath(folderPath).replace(/\/+$/, "");
  const rows = await driveEntriesTable(accountDb(username))
    .where("parentPath")
    .equals(parentPath)
    .filter(isUploadPlaceholderRow)
    .toArray();
  return rows.map((row) => JSON.parse(row.data) as WgwDriveDirectoryEntry);
}

/** The row without its upload marker: a plain listing row again. */
export function plainDriveEntryRow(row: OfflineDriveEntryRow): OfflineDriveEntryRow {
  const { upload: _marker, ...entry } = JSON.parse(row.data) as WgwDriveDirectoryEntry;
  const { uploadId: _uploadId, ...plain } = row;
  return { ...plain, data: JSON.stringify(entry) };
}

/**
 * Inside a transaction over entries. The rows of a queue item go: a
 * placeholder is deleted; a real folder (one the upload created or adds
 * into) stays and only loses its upload marker.
 */
export async function dropUploadPlaceholderRows(username: string, itemId: string): Promise<void> {
  const table = driveEntriesTable(accountDb(username));
  for (const row of await table.where("uploadId").equals(itemId).toArray()) {
    if (row.nodeId) await table.put(plainDriveEntryRow(row));
    else await table.delete(row.id);
  }
}

/** Upload markers of folders created by an upload whose contents are still in the queue, by node id. */
async function createdUploadFolderMarkers(
  username: string,
): Promise<Map<string, WgwDriveUploadPlaceholder>> {
  const folders = await driveUploadItemsTable(accountDb(username))
    .filter((item) => item.kind === "folder" && Boolean(item.createdNodeId))
    .toArray();
  return new Map(
    folders.map((item) => [
      item.createdNodeId!,
      { id: item.id, batchId: item.batchId, status: "uploading" },
    ]),
  );
}

/**
 * Add the folder's placeholders to a listing the server returned. A listed
 * folder that an upload created keeps its upload marker until its contents
 * are done.
 */
export async function withUploadPlaceholders(
  username: string,
  data: DriveUIData,
): Promise<DriveUIData> {
  const placeholders = await readUploadPlaceholderEntries(username, data.cwd);
  const markers = await createdUploadFolderMarkers(username);
  if (placeholders.length === 0 && markers.size === 0) return data;
  const files = data.directory.files.map((entry) => {
    const marker = entry.type === "dir" && entry.nodeId ? markers.get(entry.nodeId) : undefined;
    return marker ? { ...entry, upload: marker } : entry;
  });
  const listed = new Set(files.map((entry) => normalizeOfflinePath(entry.path)));
  const extra = placeholders.filter((entry) => !listed.has(normalizeOfflinePath(entry.path)));
  return { ...data, directory: { ...data.directory, files: [...files, ...extra] } };
}
