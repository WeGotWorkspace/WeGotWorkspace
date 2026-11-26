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
 * How much the device knows about a view: `syncing` before the first complete
 * pass, `complete` after it, and `unknown` for a folder or prefix view whose
 * folder the finished pass does not hold (a deep link to a path that does not
 * exist or is not visible to the person).
 */
export type FileTreeViewKnowledge = "syncing" | "complete" | "unknown";

async function viewKnowledge(username: string, view: FileTreeView): Promise<FileTreeViewKnowledge> {
  if (!(await readDriveTreeFirstSyncDone(username))) return "syncing";
  if (view.kind !== "folder" && view.kind !== "prefix") return "complete";
  const path = treeRowPath(view.path);
  const [folderRow, roots] = await Promise.all([
    path ? table(username).get(path) : Promise.resolve(undefined),
    readDriveTreeRoots(username),
  ]);
  return isKnownTreeFolder(path, folderRow, roots.values()) ? "complete" : "unknown";
}

/**
 * The status rules of the spec:
 * - `complete`: `ready`; a folder synced with zero entries is known-empty.
 * - `syncing`: `first-sync` with the rows that already arrived, or the
 *   full-pane loading state when there are none and the device is online.
 *   Offline with no rows it is `not-available`, never empty. Area-indexed views
 *   find no rows during a first sync (rows get `area` after the pass), so they
 *   stay in the first-sync state until it ends.
 * - `unknown`: the finished pass does not hold the folder, so no sync will
 *   fill it: `not-available` online too, never a spinner that does not end.
 *   Rows under it still show (the tree holds them), as `ready`.
 */
export function fileTreeViewStatus(
  knowledge: FileTreeViewKnowledge,
  rowCount: number,
  online: boolean,
): FileTreeViewStatus {
  if (knowledge === "complete") return "ready";
  if (knowledge === "unknown") return rowCount > 0 ? "ready" : "not-available";
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
  const [rows, knowledge] = await Promise.all([
    readViewRows(username, view, filter),
    viewKnowledge(username, view),
  ]);
  return {
    rows: rows.map((row) => JSON.parse(row.data) as WgwDriveDirectoryEntry),
    status: fileTreeViewStatus(knowledge, rows.length, online),
  };
}
