/**
 * Indexed reads of one file tree view (#2063 C2). Each view starts from an
 * index of `drive_entries` (`parentPath`, `area`, `ext`, `modifiedAt` or the
 * primary key), narrows on the row columns, and parses the JSON body only of
 * the rows it returns.
 */
import type { Collection, InsertType } from "dexie";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { readDocsStarredPaths } from "@/lib/offline/docs/docs-stars-store";
import { driveEntriesTable, type OfflineDriveEntryRow } from "@/lib/offline/drive/drive-schema";
import {
  readDriveTreeFirstSyncDone,
  readDriveTreeRoots,
} from "@/lib/offline/drive/drive-tree-sync";
import {
  FILE_TREE_RECENT_LIMIT,
  isKnownTreeFolder,
  isShareRootRow,
  matchesEntryFilter,
  rowInView,
  treeRowPath,
  type FileTreeEntryFilter,
  type FileTreeView,
} from "@/lib/files/tree-view/tree-view-predicates";

export type FileTreeViewStatus = "first-sync" | "ready" | "not-available";

export type FileTreeViewResult = {
  rows: WgwDriveDirectoryEntry[];
  status: FileTreeViewStatus;
};

type EntryCollection = Collection<
  OfflineDriveEntryRow,
  string,
  InsertType<OfflineDriveEntryRow, "id">
>;

function table(username: string) {
  return driveEntriesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username)));
}

/** The view's starting collection: always an index range, never the whole table. */
function viewCollection(
  username: string,
  view: Exclude<FileTreeView, { kind: "starred" }>,
  filter: FileTreeEntryFilter | undefined,
): EntryCollection {
  const entries = table(username);
  switch (view.kind) {
    case "folder":
      return entries.where("parentPath").equals(treeRowPath(view.path));
    case "all":
      return filter?.extensions
        ? entries.where("ext").anyOf([...filter.extensions])
        : entries.where("area").anyOf(["home", "group"]);
    case "recent":
      return entries.orderBy("modifiedAt").reverse();
    case "shared":
      return entries.where("area").equals("share");
    case "trash":
      return entries.where("area").equals("trash");
    case "prefix": {
      const prefix = treeRowPath(view.path);
      return prefix
        ? entries.where("id").startsWith(`${prefix}/`)
        : entries.where("area").anyOf(["home", "group", "share"]);
    }
  }
}

async function readViewRows(
  username: string,
  view: FileTreeView,
  filter: FileTreeEntryFilter | undefined,
): Promise<OfflineDriveEntryRow[]> {
  const keep = (row: OfflineDriveEntryRow) =>
    rowInView(row, view) && matchesEntryFilter(row, filter);
  if (view.kind === "starred") {
    const ids = (await readDocsStarredPaths(username)).map(treeRowPath).filter(Boolean);
    const rows = await table(username).bulkGet(ids);
    return rows.filter((row): row is OfflineDriveEntryRow => row !== undefined && keep(row));
  }
  if (view.kind === "shared") {
    const shared = await viewCollection(username, view, filter).toArray();
    const sharePaths = new Set(shared.map((row) => row.id));
    return shared.filter((row) => isShareRootRow(row, sharePaths) && keep(row));
  }
  const collection = viewCollection(username, view, filter).filter(keep);
  if (view.kind === "recent")
    return collection.limit(view.limit ?? FILE_TREE_RECENT_LIMIT).toArray();
  return collection.toArray();
}

/**
 * After a complete pass, a folder or prefix view is ready only for a folder the
 * pass knows; any other view is ready. Before it, nothing is known complete.
 */
async function viewIsComplete(username: string, view: FileTreeView): Promise<boolean> {
  if (!(await readDriveTreeFirstSyncDone(username))) return false;
  if (view.kind !== "folder" && view.kind !== "prefix") return true;
  const path = treeRowPath(view.path);
  const [folderRow, roots] = await Promise.all([
    path ? table(username).get(path) : Promise.resolve(undefined),
    readDriveTreeRoots(username),
  ]);
  return isKnownTreeFolder(path, folderRow, roots.values());
}

/**
 * The status rules of the spec: `ready` once the view is known complete (a
 * folder synced with zero entries is known-empty). Otherwise `first-sync`:
 * the rows that already arrived, or the full-pane loading state when there are
 * none and the device is online. Offline with no rows it is `not-available`,
 * never empty. Area-indexed views find no rows during a first sync (rows get
 * `area` after the pass), so they stay in the first-sync state until it ends.
 */
export function fileTreeViewStatus(
  complete: boolean,
  rowCount: number,
  online: boolean,
): FileTreeViewStatus {
  if (complete) return "ready";
  if (rowCount > 0 || online) return "first-sync";
  return "not-available";
}

/** Read one view of the local tree. Rows keep index order; `recent` is newest first. */
export async function queryFileTreeView(
  username: string,
  view: FileTreeView,
  filter: FileTreeEntryFilter | undefined,
  online: boolean,
): Promise<FileTreeViewResult> {
  const [rows, complete] = await Promise.all([
    readViewRows(username, view, filter),
    viewIsComplete(username, view),
  ]);
  return {
    rows: rows.map((row) => JSON.parse(row.data) as WgwDriveDirectoryEntry),
    status: fileTreeViewStatus(complete, rows.length, online),
  };
}
