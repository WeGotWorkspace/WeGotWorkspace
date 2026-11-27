/**
 * Pure chrome and badge selection for Docs home. Its rows come from the
 * Drive tree through `docs-home-config` (#2063 C4).
 * The workspace component owns hooks; these functions own the branch logic.
 */
import type { DriveFile } from "@/lib/files/drive-models";
import { apiPathFromUiPath, normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";
import { isSaveAsMarkdownOnlyFile } from "@/docs-core/src/docx-import/save-as-markdown-source";

type DocsHomeTitleLabels = Pick<
  DocsUILabels,
  "homeAllDocs" | "homeSharedWithMe" | "homeRecent" | "homeStarred" | "homeTrash" | "homeTitle"
>;

/** Header title for the active sidebar view, including a selected drive label. */
export function docsHomeHeaderTitle(
  view: DocsHomeView,
  labels: DocsHomeTitleLabels,
  drives: readonly { pathPrefix: string; label: string }[],
): string {
  if (view.type === "shared") return labels.homeSharedWithMe;
  if (view.type === "recent") return labels.homeRecent;
  if (view.type === "starred") return labels.homeStarred;
  if (view.type === "trash") return labels.homeTrash;
  // A tag view is titled by its tag.
  if (view.type === "tag") return view.tag;
  if (view.type === "drive") {
    return drives.find((drive) => drive.pathPrefix === view.pathPrefix)?.label ?? labels.homeTitle;
  }
  // The sidebar entry names the view, like Drive's All Files.
  return labels.homeAllDocs;
}

type DocsHomeEmptyLabels = Pick<
  DocsUILabels,
  "homeSharedEmpty" | "homeRecentEmpty" | "homeStarredEmpty" | "homeTrashEmpty" | "homeEmpty"
>;

/** Empty-state copy for the active sidebar view. Drive and All docs share the default. */
export function docsHomeEmptyMessage(view: DocsHomeView, labels: DocsHomeEmptyLabels): string {
  if (view.type === "shared") return labels.homeSharedEmpty;
  if (view.type === "recent") return labels.homeRecentEmpty;
  if (view.type === "starred") return labels.homeStarredEmpty;
  if (view.type === "trash") return labels.homeTrashEmpty;
  return labels.homeEmpty;
}

export type DocsHomeEmptyIconKind = "share" | "clock" | "star" | "trash";

type DocsHomeOfflineLabelSource = Pick<
  DocsUILabels,
  "offlineAvailable" | "offlinePendingSync" | "syncingOffline"
>;

/** Badge copy for the home list. In-flight body hydration replaces the pending label. */
export function docsHomePaneOfflineLabels(
  labels: DocsHomeOfflineLabelSource,
  syncingOffline: boolean,
): { offlineAvailable: string; offlinePendingSync: string } {
  return {
    offlineAvailable: labels.offlineAvailable,
    offlinePendingSync: syncingOffline ? labels.syncingOffline : labels.offlinePendingSync,
  };
}

/** Empty-state icon kind. `null` keeps the pane's default document icon. */
export function docsHomeEmptyIconKind(view: DocsHomeView): DocsHomeEmptyIconKind | null {
  if (view.type === "shared") return "share";
  if (view.type === "recent") return "clock";
  if (view.type === "starred") return "star";
  if (view.type === "trash") return "trash";
  return null;
}

/**
 * Row ids whose bodies are still hydrating.
 * Only pending body sync counts — never the green "available offline" set.
 */
export function docsHomeOfflineSyncingIds(
  files: readonly DriveFile[],
  bodySyncRunning: boolean,
  offlineAvailableIds: ReadonlySet<string>,
): Set<string> {
  if (!bodySyncRunning) return new Set();
  return new Set(
    files
      .filter((file) => !offlineAvailableIds.has(file.id) && !isSaveAsMarkdownOnlyFile(file))
      .map((file) => file.id),
  );
}

/**
 * Badge ids: unsaved / outbox / collab pending, plus in-flight body hydration.
 * Returns `pending` unchanged when nothing is hydrating so the set identity stays stable.
 */
export function docsHomeOfflineBadgePendingIds(
  pending: ReadonlySet<string>,
  syncing: ReadonlySet<string>,
): ReadonlySet<string> {
  if (syncing.size === 0) return pending;
  const merged = new Set(pending);
  for (const id of syncing) merged.add(id);
  return merged;
}

/**
 * Rows hidden while their trash runs: row id to the FileNode id it had then. A
 * row id is its path (#2063 C4), so a different file that later takes the path
 * (the server's copy of a kept-both create, a new Doc of that name) shows.
 */
export type DocsHomeHiddenFiles = ReadonlyMap<string, string | undefined>;

type DocsHomeVisibleFilesOptions = {
  hiddenFileIds: DocsHomeHiddenFiles;
  isStarredView: boolean;
  starsReady: boolean;
  starredPaths: ReadonlySet<string>;
};

/** Drop optimistic hides, and drop unstarred rows once the star index has settled. */
export function filterDocsHomeVisibleFiles(
  files: readonly DriveFile[],
  options: DocsHomeVisibleFilesOptions,
): DriveFile[] {
  const notHidden = files.filter(
    (file) =>
      !options.hiddenFileIds.has(file.id) || options.hiddenFileIds.get(file.id) !== file.nodeId,
  );
  if (!options.isStarredView) return notHidden;
  // Keep Starred rows until listStars settles; then drop optimistic unstars.
  if (!options.starsReady) return notHidden;
  return notHidden.filter((file) => {
    const apiPath = file.apiPath ? normalizeApiVirtualPath(file.apiPath) : null;
    return apiPath ? options.starredPaths.has(apiPath) : false;
  });
}

/** API path for a confirmed new document, or null when the name is blank. */
export function docsHomeCreateDocumentApiPath(
  name: string,
  destinationPath: string,
  username: string,
  groupRootNames: Set<string>,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const cwd = apiPathFromUiPath(destinationPath, username, groupRootNames);
  return normalizeApiVirtualPath(`${cwd}/${trimmed}`);
}
