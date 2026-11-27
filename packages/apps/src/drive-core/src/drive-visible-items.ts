import {
  DRIVE_TRASH_UI_PATH,
  SHARED_WITH_ME_UI_ROOT,
  isDriveTrashApiPath,
  isDriveTrashFolderName,
} from "@/lib/files/drive-path-utils";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";

export function isDriveUnderTrash(parent: string) {
  return parent === DRIVE_TRASH_UI_PATH || parent.startsWith(`${DRIVE_TRASH_UI_PATH}/`);
}

function matchesLocalSearch(file: DriveFile, query: string): boolean {
  if (!query) return true;
  const hay = `${file.title} ${file.excerpt}`.toLowerCase();
  return hay.includes(query);
}

function foldersFirst(items: readonly DriveFile[]): DriveFile[] {
  return [...items].sort((a, b) => {
    if (a.kind === "folder" && b.kind !== "folder") return -1;
    if (b.kind === "folder" && a.kind !== "folder") return 1;
    return 0;
  });
}

/**
 * Rows the main pane shows. Members' flat views (All Files, Recent, Starred,
 * Shared) come from the device's file tree as `viewItems`; folder and Trash
 * rows are `files`. A search shows its hits instead (server online, tree
 * offline). Without a tree (guests, mocks) the views filter `files`.
 */
export function filterDriveVisibleItems({
  files,
  liveSearchResults,
  viewItems,
  starred,
  view,
  searchQuery,
  currentUsername,
  uploadFiles,
}: {
  files: DriveFile[];
  liveSearchResults: DriveFile[] | null;
  /** Rows of a flat view from the file tree; null for folders and without a tree. */
  viewItems?: readonly DriveFile[] | null;
  starred: Record<string, boolean>;
  view: ViewKey;
  searchQuery: string;
  currentUsername: string;
  /** Rows of the Uploads view (every queued, uploading, and failed file). */
  uploadFiles?: readonly DriveFile[] | null;
}): DriveFile[] {
  const q = searchQuery.trim().toLowerCase();
  // The Uploads view lists the queue across folders, never folder rows or server search.
  if (view.type === "uploads") return (uploadFiles ?? []).filter((f) => matchesLocalSearch(f, q));
  if (liveSearchResults)
    return foldersFirst(liveSearchResults.filter((f) => matchesLocalSearch(f, q)));
  if (viewItems) {
    // An unstar shows at once, before the star set on the device changes.
    const rows =
      view.type === "starred" ? viewItems.filter((f) => starred[f.id] !== false) : viewItems;
    return foldersFirst(rows.filter((f) => matchesLocalSearch(f, q)));
  }
  const filtered = files.filter((f) => {
    let inView = false;
    if (view.type === "folder")
      inView =
        f.parent === view.path &&
        !(
          view.path === "My Drive" &&
          f.kind === "folder" &&
          (isDriveTrashFolderName(f.title) ||
            (typeof f.apiPath === "string" &&
              (isDriveTrashApiPath(f.apiPath, currentUsername) ||
                f.apiPath.startsWith("/groups/"))))
        );
    else if (view.type === "recent" || view.type === "all")
      inView = !isDriveUnderTrash(f.parent) && f.kind !== "folder";
    else if (view.type === "starred") {
      inView = !!starred[f.id] && !isDriveUnderTrash(f.parent);
    } else if (view.type === "shared") {
      inView =
        f.parent === SHARED_WITH_ME_UI_ROOT || f.parent.startsWith(`${SHARED_WITH_ME_UI_ROOT}/`);
    }
    if (!inView) return false;
    return matchesLocalSearch(f, q);
  });
  return foldersFirst(filtered);
}
