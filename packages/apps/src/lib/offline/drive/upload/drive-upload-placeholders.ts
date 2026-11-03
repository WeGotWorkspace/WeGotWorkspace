import type { DriveUIData } from "@/drive-core/src/drive-types";
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

/** Add the folder's placeholders to a listing the server returned. */
export async function withUploadPlaceholders(
  username: string,
  data: DriveUIData,
): Promise<DriveUIData> {
  const placeholders = await readUploadPlaceholderEntries(username, data.cwd);
  if (placeholders.length === 0) return data;
  const listed = new Set(data.directory.files.map((entry) => normalizeOfflinePath(entry.path)));
  const extra = placeholders.filter((entry) => !listed.has(normalizeOfflinePath(entry.path)));
  return { ...data, directory: { ...data.directory, files: [...data.directory.files, ...extra] } };
}
