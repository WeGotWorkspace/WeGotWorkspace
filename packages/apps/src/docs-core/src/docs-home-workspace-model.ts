/**
 * Pure listing, chrome, and badge selection for Docs home.
 * The workspace component owns hooks; these functions own the branch logic.
 */
import type { DriveFile } from "@/drive-core/src/drive-models";
import { apiPathFromUiPath, normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { mergeDocsHomeBrowseWithShared, type DocsHomeView } from "@/docs-core/src/docs-home-shared";

export type DocsHomeViewFlags = {
  isSharedView: boolean;
  isAllView: boolean;
  isRecentView: boolean;
  isStarredView: boolean;
  isTrashView: boolean;
  isDriveView: boolean;
  includeSharedInListing: boolean;
  usesBrowseList: boolean;
};

/** Sidebar view → which home lists are active. */
export function docsHomeViewFlags(view: DocsHomeView): DocsHomeViewFlags {
  const isSharedView = view.type === "shared";
  const isAllView = view.type === "all";
  const isRecentView = view.type === "recent";
  const isStarredView = view.type === "starred";
  const isTrashView = view.type === "trash";
  const isDriveView = view.type === "drive";
  return {
    isSharedView,
    isAllView,
    isRecentView,
    isStarredView,
    isTrashView,
    isDriveView,
    includeSharedInListing: isAllView || isSharedView,
    usesBrowseList: isAllView || isRecentView || isDriveView,
  };
}

type DocsHomeFilesInput = {
  isSharedView: boolean;
  isStarredView: boolean;
  isTrashView: boolean;
  isAllView: boolean;
  browseFiles: DriveFile[];
  sharedFiles: DriveFile[];
  starredFiles: DriveFile[];
  trashFiles: DriveFile[];
};

/**
 * Pick the row set for the active view.
 * Recent and drive stay browse-only (recent is modified-desc across drives; no shared merge).
 * Returns the source array when the view does not merge, so list identity stays stable.
 */
export function resolveDocsHomeFiles(input: DocsHomeFilesInput): DriveFile[] {
  if (input.isSharedView) return input.sharedFiles;
  if (input.isStarredView) return input.starredFiles;
  if (input.isTrashView) return input.trashFiles;
  if (input.isAllView) return mergeDocsHomeBrowseWithShared(input.browseFiles, input.sharedFiles);
  return input.browseFiles;
}

export type DocsHomeListingStatus = {
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  isOfflineListing: boolean;
  loadMore: () => void;
};

export type DocsHomeListingQuery = {
  loading: boolean;
  error: string | null;
};

export type DocsHomeBrowseListing = DocsHomeListingQuery & {
  loadingMore: boolean;
  hasMore: boolean;
  isOfflineListing: boolean;
  loadMore: () => void;
};

type DocsHomeListingStatusInput = {
  isSharedView: boolean;
  isStarredView: boolean;
  isTrashView: boolean;
  isAllView: boolean;
  usesBrowseList: boolean;
  /** True when Share operations are wired (All docs waits on the shared list too). */
  shareOperationsEnabled: boolean;
  browse: DocsHomeBrowseListing;
  shared: DocsHomeListingQuery;
  starred: DocsHomeListingQuery;
  trash: DocsHomeListingQuery;
};

/**
 * Loading, error, and paging flags for the active view.
 * All docs waits for shared-with-me so rows don't remount when shares merge in.
 */
export function resolveDocsHomeListingStatus(
  input: DocsHomeListingStatusInput,
): DocsHomeListingStatus {
  const loading = input.isSharedView
    ? input.shared.loading
    : input.isStarredView
      ? input.starred.loading
      : input.isTrashView
        ? input.trash.loading
        : input.isAllView && input.shareOperationsEnabled
          ? input.browse.loading || input.shared.loading
          : input.browse.loading;
  const error = input.isSharedView
    ? input.shared.error
    : input.isStarredView
      ? input.starred.error
      : input.isTrashView
        ? input.trash.error
        : input.browse.error;
  return {
    loading,
    loadingMore: input.usesBrowseList ? input.browse.loadingMore : false,
    hasMore: input.usesBrowseList ? input.browse.hasMore : false,
    error,
    isOfflineListing: input.usesBrowseList ? input.browse.isOfflineListing : false,
    loadMore: input.browse.loadMore,
  };
}

type DocsHomeTitleLabels = Pick<
  DocsUILabels,
  "homeSharedWithMe" | "homeRecent" | "homeStarred" | "homeTrash" | "homeTitle"
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
  if (view.type === "drive") {
    return drives.find((drive) => drive.pathPrefix === view.pathPrefix)?.label ?? labels.homeTitle;
  }
  return labels.homeTitle;
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
  return new Set(files.filter((file) => !offlineAvailableIds.has(file.id)).map((file) => file.id));
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

type DocsHomeVisibleFilesOptions = {
  hiddenFileIds: ReadonlySet<string>;
  isStarredView: boolean;
  starsReady: boolean;
  starredPaths: ReadonlySet<string>;
};

/** Drop optimistic hides, and drop unstarred rows once the star index has settled. */
export function filterDocsHomeVisibleFiles(
  files: readonly DriveFile[],
  options: DocsHomeVisibleFilesOptions,
): DriveFile[] {
  const notHidden = files.filter((file) => !options.hiddenFileIds.has(file.id));
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
