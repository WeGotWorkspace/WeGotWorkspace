/**
 * Pure view rules of the local file tree (#2063 C2). Every Drive and Docs home
 * list is one of these views on `drive_entries`, narrowed by an entry filter.
 * The rules read only a row's indexed columns (`id`, `parentPath`, `type`,
 * `ext`, `area`), never its JSON body, so a 20k-row view parses only the rows
 * it shows.
 */
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import type { OfflineDriveEntryRow } from "@/lib/offline/drive/drive-schema";
import {
  isHiddenTreePath,
  isTrashItemPath,
  isTrashTreePath,
} from "@/lib/offline/drive/drive-tree-rows";

/** One list of the file tree. Paths are drive paths, with or without a leading slash. */
export type FileTreeView =
  /** The direct children of one folder. */
  | { kind: "folder"; path: string }
  /** Every file in home and the team drives, flat (Drive All files, Docs home). */
  | { kind: "all" }
  /** Files by modification time, newest first, outside Trash. */
  | { kind: "recent"; limit?: number }
  /** The starred paths (meta key `docs.starredPaths`, shared by both apps). */
  | { kind: "starred" }
  /** The roots shared with the person. */
  | { kind: "shared" }
  /** Every item with one tag, across folders and drives, outside Trash (#2402). */
  | { kind: "tag"; tag: string }
  /** The items in Trash (direct children of a `.Trash` folder). */
  | { kind: "trash" }
  /** Every file under one path, flat (Docs home per drive, project or team). */
  | { kind: "prefix"; path: string };

/**
 * What an app lists of a view. Drive passes none; Docs passes its extensions.
 * `extensions` narrows files only; folders stay unless `filesOnly`.
 */
export type FileTreeEntryFilter = {
  /** Lower-case extensions without the dot. */
  extensions?: readonly string[];
  /** Drop folders too (flat lists). */
  filesOnly?: boolean;
  /** Case-insensitive substring of the name; the offline name filter. */
  nameQuery?: string;
};

/** The columns the predicates read. */
export type FileTreeRowColumns = Pick<
  OfflineDriveEntryRow,
  "id" | "parentPath" | "type" | "ext" | "area" | "tags"
>;

/** Default length of the recent view. */
export const FILE_TREE_RECENT_LIMIT = 50;

/** Drive path in row form: no leading or trailing slash. */
export function treeRowPath(path: string): string {
  return normalizeOfflinePath(path).replace(/\/+$/, "");
}

function rowName(row: FileTreeRowColumns): string {
  return row.id.split("/").pop() ?? "";
}

/**
 * True when a row may appear in any list: dot paths other than `.Trash` never
 * do, also for files inside `.notes` or `.attachments`. Upload placeholders
 * (`\u0000upload:` names) are list rows of their folder.
 */
export function isListableTreeRow(row: FileTreeRowColumns): boolean {
  return !isHiddenTreePath(row.id);
}

/** True when the row passes an app's entry filter. */
export function matchesEntryFilter(
  row: FileTreeRowColumns,
  filter: FileTreeEntryFilter | undefined,
): boolean {
  if (!filter) return true;
  if (row.type === "dir") {
    if (filter.filesOnly) return false;
  } else if (filter.extensions && !filter.extensions.includes(row.ext ?? "")) {
    return false;
  }
  const query = filter.nameQuery?.trim().toLowerCase();
  return !query || rowName(row).toLowerCase().includes(query);
}

function isFlatView(view: FileTreeView): boolean {
  return view.kind === "all" || view.kind === "recent" || view.kind === "prefix";
}

/**
 * True when the row belongs to the view by its own columns. `shared` also
 * needs {@link isShareRootRow}, `starred` the star set; both are applied by the
 * query, since they look beyond one row.
 */
export function rowInView(row: FileTreeRowColumns, view: FileTreeView): boolean {
  if (!isListableTreeRow(row)) return false;
  if (isFlatView(view) && row.type !== "file") return false;
  const inTrash = row.area === "trash" || isTrashTreePath(row.id);
  switch (view.kind) {
    case "folder": {
      const folder = treeRowPath(view.path);
      if (row.parentPath !== folder) return false;
      // Trash shows only in the Trash view, or when browsing inside Trash.
      return !inTrash || isTrashTreePath(folder);
    }
    case "all":
      return row.area === "home" || row.area === "group";
    case "recent":
      return row.area !== undefined && !inTrash;
    case "starred":
      return !inTrash;
    case "shared":
      return row.area === "share";
    case "tag": {
      const wanted = view.tag.trim().toLowerCase();
      return !inTrash && (row.tags ?? []).some((tag) => tag.toLowerCase() === wanted);
    }
    case "trash":
      return inTrash && isTrashItemPath(row.id);
    case "prefix": {
      const prefix = treeRowPath(view.path);
      return !inTrash && (prefix === "" || row.id.startsWith(`${prefix}/`));
    }
  }
}

/**
 * True for a share root: a `share` row whose parent folder is not itself a
 * shared row on the device. `sharePaths` holds every `share` row's path.
 */
export function isShareRootRow(row: FileTreeRowColumns, sharePaths: ReadonlySet<string>): boolean {
  return row.area === "share" && !sharePaths.has(row.parentPath);
}

/**
 * True when the device knows a folder's children after a complete pass: the
 * folder has a row, is an account root (home or team drive, which have no row),
 * or is above one (the top level, `groups`). A folder outside all of these has
 * not synced, so its view is "not available offline", never empty.
 */
export function isKnownTreeFolder(
  path: string,
  folderRow: FileTreeRowColumns | undefined,
  accountRootPaths: Iterable<string>,
): boolean {
  const folder = treeRowPath(path);
  if (isHiddenTreePath(folder)) return false;
  if (folderRow?.type === "dir") return true;
  for (const root of accountRootPaths) {
    const rootPath = treeRowPath(root);
    if (folder === "" || rootPath === folder || rootPath.startsWith(`${folder}/`)) return true;
  }
  return false;
}
