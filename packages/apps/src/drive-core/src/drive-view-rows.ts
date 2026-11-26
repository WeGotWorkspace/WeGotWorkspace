/**
 * Drive views on the local file tree (#2063 C3): which tree view a Drive view
 * reads, and how tree entries become Drive rows. Every Drive view reads the
 * same `drive_entries` rows through `useFileTreeView`; nothing here fetches.
 */
import {
  driveFileForSharedWithMeListing,
  driveFileFromEntry,
} from "@/drive-core/src/drive-file-utils";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import type { FileTreeView } from "@/lib/files/tree-view/tree-view-predicates";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import {
  DRIVE_TRASH_UI_PATH,
  SHARED_WITH_ME_UI_ROOT,
  apiPathFromUiPath,
} from "@/lib/files/drive-path-utils";

const GROUPS_ROOT = "Groups";

/**
 * The tree view of a Drive view; null for views that are not lists of the
 * tree (Uploads, Access). The Trash folder is the `trash` view, so a device
 * that never trashed anything shows Trash as known-empty, not unsynced.
 */
export function driveTreeViewFor(
  view: ViewKey,
  username: string,
  groupRoots: Set<string>,
): FileTreeView | null {
  switch (view.type) {
    case "all":
      return { kind: "all" };
    case "recent":
      return { kind: "recent" };
    case "starred":
      return { kind: "starred" };
    case "shared":
      return { kind: "shared" };
    case "folder":
      if (view.path === DRIVE_TRASH_UI_PATH) return { kind: "trash" };
      if (view.path === SHARED_WITH_ME_UI_ROOT) return { kind: "shared" };
      return { kind: "folder", path: apiPathFromUiPath(view.path, username, groupRoots) };
    default:
      return null;
  }
}

/**
 * All Files rows name their drive the way the sidebar does: Personal, or the
 * team drive's display name instead of its slug.
 */
export function withDriveRootLocation(
  file: DriveFile,
  rootLabels: Readonly<Record<string, string>>,
): DriveFile {
  const segments = file.parent.split("/");
  if (segments[0] !== GROUPS_ROOT || !segments[1]) return file;
  const label = rootLabels[`${GROUPS_ROOT}/${segments[1]}`];
  return label ? { ...file, location: label } : file;
}

/**
 * Drive rows of a tree view. Shared rows sit under Shared with me with their
 * owner; flat views name their drive; Recent is newest first (the query
 * returns it that way, the others in index order).
 */
export function driveFilesFromTreeEntries(
  entries: readonly WgwDriveDirectoryEntry[],
  tree: FileTreeView,
  username: string,
  rootLabels: Readonly<Record<string, string>>,
): DriveFile[] {
  if (tree.kind === "shared") {
    return entries.map((entry) => driveFileForSharedWithMeListing(entry, username));
  }
  const files = entries.map((entry) => driveFileFromEntry(entry, username));
  if (tree.kind === "folder" || tree.kind === "trash") return files;
  const labeled = files.map((file) => withDriveRootLocation(file, rootLabels));
  if (tree.kind === "all") labeled.sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));
  return labeled;
}

/** Changes the rows of a flat view (All Files, Recent, Starred, Shared) in place. */
export type DriveAllFilesPatch = (update: (rows: DriveFile[]) => DriveFile[]) => void;

/**
 * Shows a write on the All Files rows at once (`update`) and returns the undo: the
 * rows as they were, then a reload. Outside All Files both are no-ops.
 */
export function patchAllFilesRows(
  view: ViewKey,
  patch: DriveAllFilesPatch | undefined,
  reload: (() => void) | undefined,
  update: (rows: DriveFile[]) => DriveFile[],
): () => void {
  if (view.type !== "all" || !patch) return () => undefined;
  let before: DriveFile[] | null = null;
  patch((rows) => {
    before ??= rows;
    return update(rows);
  });
  return () => {
    const rows = before;
    if (rows) patch(() => rows);
    reload?.();
  };
}

/** The rows `ids` name, from any view (All Files, Starred, Shared, the open folder). */
export function driveRowsById(
  ids: readonly string[],
  fileById: (id: string) => DriveFile | null,
): DriveFile[] {
  const rows = new Map<string, DriveFile>();
  for (const id of ids) {
    const row = fileById(id);
    if (row) rows.set(row.id, row);
  }
  return [...rows.values()];
}
