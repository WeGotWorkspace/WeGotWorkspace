import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import { driveEntriesTable, type OfflineDriveEntryRow } from "@/lib/offline/drive/drive-schema";
import {
  buildUploadFolderPlaceholderRow,
  plainDriveEntryRow,
} from "@/lib/offline/drive/upload/drive-upload-placeholders";
import type { OfflineDriveUploadItemRow } from "@/lib/offline/drive/upload/drive-upload-schema";

function entriesTable(username: string) {
  return driveEntriesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username)));
}

/** `parent/name` as a cache path (no leading slash). */
export function joinDrivePath(parent: string, name: string): string {
  const folder = normalizeOfflinePath(parent).replace(/\/+$/, "");
  return folder ? `${folder}/${name}` : name;
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

/** The marker a folder row carries while its upload runs. */
export function withUploadMarker(
  row: OfflineDriveEntryRow,
  item: Pick<OfflineDriveUploadItemRow, "id" | "batchId" | "status">,
  entry: WgwDriveDirectoryEntry = JSON.parse(row.data) as WgwDriveDirectoryEntry,
): OfflineDriveEntryRow {
  const upload = { id: item.id, batchId: item.batchId, status: item.status };
  return { ...row, uploadId: item.id, data: JSON.stringify({ ...entry, upload }) };
}

/**
 * Inside a transaction over entries. The folder item's row at `path`: a
 * placeholder, or, when a real folder is already cached there, that folder
 * with the upload marker (it adds into it). A row of another upload stays.
 */
async function placeFolderRow(
  username: string,
  path: string,
  item: OfflineDriveUploadItemRow,
): Promise<void> {
  const table = entriesTable(username);
  const existing = await table.get(path);
  if (existing?.uploadId && existing.uploadId !== item.id) return;
  // A file at the path stays as it is; no folder row goes there.
  if (existing && existing.type !== "dir") return;
  if (existing?.nodeId) {
    await table.put(withUploadMarker(existing, item));
    return;
  }
  const name = path.slice(path.lastIndexOf("/") + 1);
  await table.put(buildUploadFolderPlaceholderRow(parentOf(path), { ...item, name }));
}

/**
 * Inside a transaction over entries. Moves the rows of `items` from folder
 * path `from` to `to`: the folder's own row and every placeholder below it.
 * A real folder the upload was adding into stays where it is and only loses
 * its marker.
 */
export async function moveUploadFolderRows(
  username: string,
  items: ReadonlyMap<string, OfflineDriveUploadItemRow>,
  from: string,
  to: string,
): Promise<void> {
  if (from === to) return;
  const table = entriesTable(username);
  const rows = await table
    .where("uploadId")
    .anyOf([...items.keys()])
    .toArray();
  for (const row of rows) {
    if (row.id !== from && !row.id.startsWith(`${from}/`)) continue;
    const item = items.get(row.uploadId!)!;
    const path = `${to}${row.id.slice(from.length)}`;
    if (row.type === "dir") {
      if (row.nodeId) await table.put(plainDriveEntryRow(row));
      else await table.delete(row.id);
      await placeFolderRow(username, path, item);
      continue;
    }
    const entry = JSON.parse(row.data) as WgwDriveDirectoryEntry;
    await table.delete(row.id);
    await table.put({
      ...row,
      id: path,
      parentPath: parentOf(path),
      data: JSON.stringify({ ...entry, path: `/${path}` }),
    });
  }
}

/** Whether `path` is a folder an upload has not created yet (only its placeholders exist). */
export async function isPendingUploadFolderPath(username: string, path: string): Promise<boolean> {
  const row = await entriesTable(username).get(normalizeOfflinePath(path).replace(/\/+$/, ""));
  return row?.type === "dir" && Boolean(row.uploadId) && !row.nodeId;
}
