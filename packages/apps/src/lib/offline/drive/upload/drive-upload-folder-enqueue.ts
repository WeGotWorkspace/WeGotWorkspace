import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import { readDirectoryEntriesFromCache } from "@/lib/offline/drive/drive-directory-offline-store";
import { driveEntriesTable, type OfflineDriveEntryRow } from "@/lib/offline/drive/drive-schema";
import {
  planLocalCopies,
  requestPersistentStorageOnce,
} from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { notifyDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import { joinDrivePath } from "@/lib/offline/drive/upload/drive-upload-folder-placeholders";
import { buildUploadFolderPlaceholderRow } from "@/lib/offline/drive/upload/drive-upload-placeholders";
import {
  driveUploadBatchesTable,
  driveUploadItemsTable,
  type DriveUploadTargetFolder,
  type OfflineDriveUploadItemRow,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import {
  newDriveUploadBatchRow,
  newDriveUploadItem,
  storeItem,
  type EnqueuedDriveUploadBatch,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { keepBothName } from "@/lib/offline/drive/upload/drive-upload-transfer";

/**
 * A picked or dropped folder tree (see `drive-upload-folder-walk.ts`):
 * folder paths relative to the target folder, and each file with the
 * relative path of the folder it sits in (`""` = the target folder itself).
 */
export type DriveUploadTreeInput = {
  folders: readonly string[];
  files: readonly { file: File; folder: string }[];
};

export type EnqueueDriveUploadFolderBatchInput = {
  /** Cache path of the target folder. */
  folderPath: string;
  targetFolder: DriveUploadTargetFolder;
  tree: DriveUploadTreeInput;
  /** See `EnqueueDriveUploadsInput.notify`. */
  notify?: boolean;
};

export type EnqueuedDriveUploadFolderBatch = EnqueuedDriveUploadBatch & {
  /** Folder items, parents first. */
  folderIds: string[];
};

/** Every folder of the tree, parents first, including parents only named by a deeper path. */
function treeFolders(tree: DriveUploadTreeInput): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    const parts = path.split("/").filter(Boolean);
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const prefix = parts.slice(0, depth).join("/");
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      ordered.push(prefix);
    }
  };
  for (const folder of tree.folders) add(folder);
  for (const { folder } of tree.files) add(folder);
  return ordered;
}

function subtreeTotals(tree: DriveUploadTreeInput, folder: string) {
  const files = tree.files.filter(
    (entry) => entry.folder === folder || entry.folder.startsWith(`${folder}/`),
  );
  return {
    subtreeBytes: files.reduce((sum, entry) => sum + entry.file.size, 0),
    subtreeFiles: files.length,
  };
}

/**
 * Store a folder tree as one batch waiting for the batch dialog, like
 * `enqueueDriveUploadBatch` does for files. Each folder becomes a folder
 * item, created parents first by the uploader; its files and subfolders
 * point at it with a `temporary` target until it exists. A top-level folder
 * whose name the cached listing already has gets the next free name
 * (*Keep both*, the default; the dialog may switch it to *Merge*). Folder
 * placeholders sit at the folder's real path, so they can be opened, also
 * offline.
 */
export async function enqueueDriveUploadFolderBatch(
  username: string,
  input: EnqueueDriveUploadFolderBatchInput,
): Promise<EnqueuedDriveUploadFolderBatch> {
  await requestPersistentStorageOnce();
  const files = input.tree.files;
  const localPlan = await planLocalCopies(files.map(({ file }) => file.size));
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const [batches, items, entries] = [
    driveUploadBatchesTable(db),
    driveUploadItemsTable(db),
    driveEntriesTable(db),
  ];
  const parentPath = normalizeOfflinePath(input.folderPath).replace(/\/+$/, "");
  const taken = new Set(
    (await readDirectoryEntriesFromCache(username, parentPath)).map((entry) => entry.name),
  );
  const now = Date.now();
  const batch = newDriveUploadBatchRow(input.targetFolder, now);
  const folders = new Map<string, { item: OfflineDriveUploadItemRow; path: string }>();
  const placeholders: OfflineDriveEntryRow[] = [];
  for (const [index, relative] of treeFolders(input.tree).entries()) {
    const slash = relative.lastIndexOf("/");
    const sourceName = relative.slice(slash + 1);
    const parent = slash >= 0 ? folders.get(relative.slice(0, slash)) : undefined;
    const name = parent ? sourceName : keepBothName(sourceName, taken, "folder");
    if (!parent) taken.add(name);
    const item: OfflineDriveUploadItemRow = {
      id: crypto.randomUUID(),
      batchId: batch.id,
      kind: "folder",
      targetFolder: parent ? { kind: "temporary", id: parent.item.id } : batch.targetFolder,
      ...(parent ? { inFolder: parent.item.id } : { onExisting: "keep_both" as const }),
      name,
      sourceName,
      size: 0,
      mimeType: "",
      status: "queued",
      bytesDone: 0,
      createdAt: now + index,
      localCopy: true,
      transientFailures: 0,
      ...subtreeTotals(input.tree, relative),
    };
    const placeIn = parent?.path ?? parentPath;
    folders.set(relative, { item, path: joinDrivePath(placeIn, name) });
    placeholders.push(buildUploadFolderPlaceholderRow(placeIn, item));
  }
  await db.transaction("rw", batches, items, entries, async () => {
    await batches.put(batch);
    await items.bulkPut([...folders.values()].map(({ item }) => item));
    // A row already cached at that path (a stale listing) is left alone.
    const cached = await entries.bulkGet(placeholders.map((row) => row.id));
    await entries.bulkPut(placeholders.filter((_, index) => !cached[index]));
  });
  const itemIds: string[] = [];
  for (const [index, { file, folder }] of files.entries()) {
    const parent = folder ? folders.get(folder) : undefined;
    const base = newDriveUploadItem(
      batch,
      file,
      now + folders.size + index,
      localPlan[index] ?? true,
    );
    const item: OfflineDriveUploadItemRow = parent
      ? {
          ...base,
          targetFolder: { kind: "temporary", id: parent.item.id },
          inFolder: parent.item.id,
        }
      : base;
    await storeItem(username, db, parent?.path ?? parentPath, item, file);
    itemIds.push(item.id);
  }
  if (input.notify !== false) notifyDriveUploadQueueChanged(username);
  const folderIds = [...folders.values()].map(({ item }) => item.id);
  return { batchId: batch.id, itemIds, folderIds };
}
