import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import { readDirectoryEntriesFromCache } from "@/lib/offline/drive/drive-directory-offline-store";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import {
  describeDriveUploadBatchConflicts,
  type DriveUploadBatchConflicts,
} from "@/lib/offline/drive/upload/drive-upload-conflicts";
import { notifyDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import {
  joinDrivePath,
  moveUploadFolderRows,
} from "@/lib/offline/drive/upload/drive-upload-folder-placeholders";
import { driveUploadSubtreeIds } from "@/lib/offline/drive/upload/drive-upload-folder-rows";
import { driveUploadFolderParentPath } from "@/lib/offline/drive/upload/drive-upload-folder-store";
import { findUploadPlaceholder } from "@/lib/offline/drive/upload/drive-upload-placeholders";
import {
  driveUploadItemsTable,
  type DriveUploadFolderOnExisting,
  type OfflineDriveUploadItemRow,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import { keepBothName } from "@/lib/offline/drive/upload/drive-upload-transfer";

/** A top-level folder of the upload whose name the target folder already has. */
export type DriveUploadFolderClash = {
  itemId: string;
  /** The folder's own name. */
  name: string;
  /** The name it gets with *Keep both*. */
  keptAsName: string;
  /** The name belongs to a folder known here: *Merge* adds into it. */
  canMerge: boolean;
};

/**
 * The folder step of the batch dialog. Default *Keep both*; *Merge* adds the
 * folders that `canMerge` into the existing ones (nested folders always
 * merge). `mergeConflicts`: the batch's file name conflicts as they are with
 * *Merge* (they replace the dialog's `conflicts` then), null when none.
 */
export type DriveUploadFolderQuestion = {
  folders: DriveUploadFolderClash[];
  mergeConflicts: DriveUploadBatchConflicts | null;
};

type FolderPlan = {
  item: OfflineDriveUploadItemRow;
  /** Where its row is now. */
  path: string;
  parentPath: string;
  keptAsName: string;
  /** Path of the cached folder with its own name; unset when there is none. */
  existing?: { path: string; isFolder: boolean };
};

function accountDb(username: string) {
  return offlineDbForAccount(offlineAccountKeyFromUsername(username));
}

async function topLevelFolders(username: string, batchId: string) {
  const items = await driveUploadItemsTable(accountDb(username))
    .where("batchId")
    .equals(batchId)
    .sortBy("createdAt");
  return { items, top: items.filter((item) => item.kind === "folder" && !item.inFolder) };
}

async function planFolder(
  username: string,
  item: OfflineDriveUploadItemRow,
): Promise<FolderPlan | null> {
  const parentPath = await driveUploadFolderParentPath(username, item);
  if (parentPath === null) return null;
  const row = await findUploadPlaceholder(username, item.id);
  const path = row?.id ?? joinDrivePath(parentPath, item.name);
  // Its own placeholder is no clash; a real folder it already merged into is.
  const ownPlaceholder = row && !row.nodeId ? row.id : null;
  const others = (await readDirectoryEntriesFromCache(username, parentPath)).filter(
    (entry) => normalizeOfflinePath(entry.path) !== ownPlaceholder,
  );
  const sourceName = item.sourceName ?? item.name;
  const keptAsName = keepBothName(sourceName, new Set(others.map((entry) => entry.name)), "folder");
  const existing = others.find((entry) => entry.name.toLowerCase() === sourceName.toLowerCase());
  return {
    item,
    path,
    parentPath,
    keptAsName,
    ...(existing
      ? {
          existing: { path: normalizeOfflinePath(existing.path), isFolder: isRealFolder(existing) },
        }
      : {}),
  };
}

/** A folder the server has (an upload's placeholder cannot be added into yet). */
function isRealFolder(entry: WgwDriveDirectoryEntry): boolean {
  return entry.type === "dir" && Boolean(entry.nodeId);
}

async function planBatchFolders(username: string, batchId: string) {
  const { items, top } = await topLevelFolders(username, batchId);
  const plans: FolderPlan[] = [];
  for (const item of top) {
    const plan = await planFolder(username, item);
    if (plan?.existing) plans.push(plan);
  }
  return { items, plans };
}

/**
 * The folder question of a batch: top-level folders whose name the cached
 * listing of the target folder already has. Null when there is none.
 */
export async function describeDriveUploadFolderConflicts(
  username: string,
  batchId: string,
  sessionVersionCheck: boolean | null,
): Promise<DriveUploadFolderQuestion | null> {
  const { plans } = await planBatchFolders(username, batchId);
  const merged = plans.filter((plan) => plan.existing!.isFolder);
  // Nothing to ask when no clash can merge: enqueue already kept both.
  if (merged.length === 0) return null;
  const parentPathOf = (path: string) => {
    for (const plan of merged) {
      if (path === plan.path || path.startsWith(`${plan.path}/`)) {
        return `${plan.existing!.path}${path.slice(plan.path.length)}`;
      }
    }
    return path;
  };
  const mergeConflicts =
    merged.length > 0
      ? await describeDriveUploadBatchConflicts(username, batchId, sessionVersionCheck, {
          parentPathOf,
        })
      : null;
  return {
    folders: plans.map((plan) => ({
      itemId: plan.item.id,
      name: plan.item.sourceName ?? plan.item.name,
      keptAsName: plan.keptAsName,
      canMerge: plan.existing!.isFolder,
    })),
    mergeConflicts: mergeConflicts && mergeConflicts.conflicts.length > 0 ? mergeConflicts : null,
  };
}

/**
 * The folder answer, before the batch is released. *Merge*: each clashing
 * top-level folder that can merge takes the existing folder's name and its
 * placeholders move into it; the rest keep both. Applying the same answer
 * again changes nothing; another answer moves them back.
 */
export async function applyDriveUploadFolderChoice(
  username: string,
  batchId: string,
  choice: DriveUploadFolderOnExisting,
): Promise<void> {
  const { items, plans } = await planBatchFolders(username, batchId);
  if (plans.length === 0) return;
  const db = accountDb(username);
  const table = driveUploadItemsTable(db);
  await db.transaction("rw", table, driveEntriesTable(db), async () => {
    for (const plan of plans) {
      const merge = choice === "merge" && plan.existing!.isFolder;
      const path = merge ? plan.existing!.path : joinDrivePath(plan.parentPath, plan.keptAsName);
      const item: OfflineDriveUploadItemRow = {
        ...plan.item,
        name: path.slice(path.lastIndexOf("/") + 1),
        onExisting: merge ? "merge" : "keep_both",
      };
      await table.put(item);
      const below = driveUploadSubtreeIds(items, item.id);
      const moved = new Map(
        items.filter((candidate) => below.has(candidate.id)).map((row) => [row.id, row]),
      );
      moved.set(item.id, item);
      await moveUploadFolderRows(username, moved, plan.path, path);
    }
  });
  notifyDriveUploadQueueChanged(username);
}
