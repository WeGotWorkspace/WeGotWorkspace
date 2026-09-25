import { useCallback, useEffect, useMemo, useState } from "react";
import { DOCS_VIEW_MODE_STORAGE_KEY } from "@/hooks/persisted-view-mode";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { mergeDocsLabels, type DocsUILabels } from "@/docs-core/src/docs-labels";
import { useDocumentTitle } from "@/lib/document-title";
import { useDocsHomeList, type DocsHomeFetcher } from "@/docs-core/src/use-docs-home-list";
import { useDocsHomeSharedList } from "@/docs-core/src/use-docs-home-shared-list";
import { useDocsHomeStarredList } from "@/docs-core/src/use-docs-home-starred-list";
import { useDocsHomeTrashList } from "@/docs-core/src/use-docs-home-trash-list";
import {
  useDocsHomeOfflineAvailability,
  useDocsHomeOpenGuard,
} from "@/docs-core/src/use-docs-home-offline-availability";
import { docsHomeBrowsePathPrefix, type DocsHomeView } from "@/docs-core/src/docs-home-shared";
import { useDocsHomeSidebarModel } from "@/docs-core/src/use-docs-home-sidebar-model";
import { useDocsHomeActions } from "@/docs-core/src/use-docs-home-actions";
import {
  useDocsHomeGroupRootEffects,
  useDocsHomeGroupRootModel,
} from "@/docs-core/src/use-docs-home-group-roots";
import { useDocsHomeCreateDialog } from "@/docs-core/src/use-docs-home-create-dialog";
import {
  docsHomeEmptyIconKind,
  docsHomeEmptyMessage,
  docsHomeHeaderTitle,
  docsHomeOfflineBadgePendingIds,
  docsHomeOfflineSyncingIds,
  docsHomeViewFlags,
  filterDocsHomeVisibleFiles,
  resolveDocsHomeFiles,
  resolveDocsHomeListingStatus,
} from "@/docs-core/src/docs-home-workspace-model";
import { DocsHomeWorkspaceFrame } from "@/docs-core/src/docs-home-workspace-frame";
import type { DriveAPIOperations, DriveShareOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  createHybridDocsDriveOperations,
  getDocsSyncRunner,
} from "@/lib/offline/docs/docs-hybrid-operations";
import { readDocsBodySyncProgress } from "@/lib/offline/docs/docs-body-sync";
import { useOfflineBodySyncProgress } from "@/lib/offline/use-offline-body-sync-progress";
import { useOfflineReconnectFlush } from "@/lib/offline/use-offline-reconnect-flush";
import { useOfflineSyncToast } from "@/lib/offline/use-offline-sync-toast";
import "@/docs-core/src/docs-workspace.css";
import "@/docs-core/src/docs-home-workspace.css";

export type DocsHomeWorkspaceProps = {
  session: WorkspaceSession;
  /** Injectable browse fetcher (mock in Storybook/Vitest). */
  fetcher?: DocsHomeFetcher;
  /** When set, enables Dexie cache read/write for offline home browse (live app only). */
  offlineUsername?: string | null;
  /** Live drive operations powering row actions (star/download/rename/move/trash). */
  operations?: DriveAPIOperations;
  /** When set, enables Share in docs home row action menus. */
  shareOperations?: DriveShareOperations;
  /** Called with the drive API path when a row is opened (route navigation lives in `*App`). */
  onOpenFile?: (apiPath: string) => void;
  /**
   * Called with the new document's drive API path when "New document" is clicked.
   * The `*App` layer owns creating the file and navigating to the Docs editor.
   */
  onCreateDocument?: (apiPath: string) => void;
  onLogout?: () => void;
  labels?: Partial<DocsUILabels>;
  className?: string;
};

export function DocsHomeWorkspace({
  session,
  fetcher,
  offlineUsername: offlineUsernameProp = null,
  operations,
  shareOperations,
  onOpenFile,
  onCreateDocument,
  onLogout,
  labels: labelOverrides,
  className,
}: DocsHomeWorkspaceProps) {
  const labels = mergeDocsLabels(labelOverrides);
  const username = session.user.username ?? "";
  const { showError } = useAppToast();
  const offlineUsername = offlineUsernameProp;

  const driveOperations = useMemo(() => {
    if (!offlineUsername) return operations;
    return createHybridDocsDriveOperations(offlineUsername);
  }, [offlineUsername, operations]);
  const listingOperations = driveOperations ?? operations;

  const { online } = useConnectivity();
  const searchEnabled = !offlineUsername || online;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = usePersistedViewMode({
    storageKey: DOCS_VIEW_MODE_STORAGE_KEY,
    defaultMode: "list",
  });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<DocsHomeView>({ type: "all" });

  const {
    labeledGroupRoots,
    drives,
    groupRootSlugs,
    groupRootNames,
    setKnownGroupRoots,
    setGroupDirectory,
  } = useDocsHomeGroupRootModel({
    username,
    personalDriveLabel: labels.homeMyDrive,
  });

  const {
    isSharedView,
    isAllView,
    isStarredView,
    isTrashView,
    includeSharedInListing,
    usesBrowseList,
  } = docsHomeViewFlags(view);
  const browsePathPrefix = docsHomeBrowsePathPrefix(view);

  const browseList = useDocsHomeList({
    username,
    query,
    pathPrefix: browsePathPrefix,
    fetcher,
    offlineUsername,
    enabled: usesBrowseList,
    groupRoots: labeledGroupRoots,
  });

  const sharedList = useDocsHomeSharedList({
    username,
    shareOperations,
    // Prefetch whenever shares are available so All docs can merge them in.
    enabled: Boolean(shareOperations),
    query: includeSharedInListing ? query : "",
  });

  const starredList = useDocsHomeStarredList({
    username,
    operations: listingOperations,
    enabled: isStarredView && Boolean(listingOperations),
    query: isStarredView ? query : "",
  });

  const trashList = useDocsHomeTrashList({
    username,
    operations: listingOperations,
    enabled: isTrashView && Boolean(listingOperations),
    query: isTrashView ? query : "",
  });

  const files = useMemo(
    () =>
      resolveDocsHomeFiles({
        isSharedView,
        isStarredView,
        isTrashView,
        isAllView,
        browseFiles: browseList.files,
        sharedFiles: sharedList.files,
        starredFiles: starredList.files,
        trashFiles: trashList.files,
      }),
    [
      browseList.files,
      isAllView,
      isSharedView,
      isStarredView,
      isTrashView,
      sharedList.files,
      starredList.files,
      trashList.files,
    ],
  );

  const listing = resolveDocsHomeListingStatus({
    isSharedView,
    isStarredView,
    isTrashView,
    isAllView,
    usesBrowseList,
    shareOperationsEnabled: Boolean(shareOperations),
    browseLoading: browseList.loading,
    browseError: browseList.error,
    browseLoadingMore: browseList.loadingMore,
    browseHasMore: browseList.hasMore,
    browseIsOfflineListing: browseList.isOfflineListing,
    browseLoadMore: browseList.loadMore,
    sharedLoading: sharedList.loading,
    sharedError: sharedList.error,
    starredLoading: starredList.loading,
    starredError: starredList.error,
    trashLoading: trashList.loading,
    trashError: trashList.error,
  });

  const reloadBrowse = browseList.reload;
  const reloadShared = sharedList.reload;
  const reloadStarred = starredList.reload;
  const reloadTrash = trashList.reload;
  const reload = useCallback(() => {
    reloadBrowse();
    reloadShared();
    reloadStarred();
    reloadTrash();
  }, [reloadBrowse, reloadShared, reloadStarred, reloadTrash]);

  const { offlineAvailableIds, offlinePendingSyncIds, refresh } = useDocsHomeOfflineAvailability(
    files,
    Boolean(offlineUsername),
    offlineUsername,
  );

  const syncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      if (!offlineUsername) return;
      await getDocsSyncRunner(offlineUsername).flush();
    },
    afterFlush: refresh,
  });

  const readBodySyncProgress = useCallback(() => {
    if (!offlineUsername) {
      return Promise.resolve({
        running: false,
        total: 0,
        synced: 0,
        failed: 0,
        updatedAt: 0,
      });
    }
    return readDocsBodySyncProgress(offlineUsername);
  }, [offlineUsername]);

  const docsBodySyncProgress = useOfflineBodySyncProgress({
    enabled: Boolean(offlineUsername),
    readProgress: readBodySyncProgress,
  });

  useOfflineSyncToast(syncing, labels.toastSynced);

  useEffect(() => {
    if (online && offlineUsername) refresh();
  }, [online, offlineUsername, refresh]);

  useEffect(() => {
    if (!searchEnabled && query) setQuery("");
  }, [searchEnabled, query]);

  /** Row badge dots: only pending body sync or unsaved/outbox/collab — never green "available offline". */
  const offlineSyncingIds = useMemo(
    () => docsHomeOfflineSyncingIds(files, docsBodySyncProgress.running, offlineAvailableIds),
    [docsBodySyncProgress.running, files, offlineAvailableIds],
  );
  const offlineBadgePendingIds = useMemo(
    () => docsHomeOfflineBadgePendingIds(offlinePendingSyncIds, offlineSyncingIds),
    [offlinePendingSyncIds, offlineSyncingIds],
  );

  const canOpenOffline = useDocsHomeOpenGuard({
    isOfflineListing: listing.isOfflineListing,
    offlineAvailableIds,
    onUnavailable: () => showError(labels.homeNotAvailableOffline),
  });

  // Discover group roots after `files` exists. State lives above the browse list.
  useDocsHomeGroupRootEffects({
    operations,
    online,
    files,
    setKnownGroupRoots,
    setGroupDirectory,
  });

  const headerTitle = docsHomeHeaderTitle(view, labels, drives);
  useDocumentTitle(headerTitle);

  const actions = useDocsHomeActions({
    operations: listingOperations,
    files,
    username,
    groupRoots: groupRootSlugs,
    offlineUsername,
    onAvailabilityChanged: refresh,
    reload,
    inTrashView: isTrashView,
  });

  const visibleFiles = useMemo(
    () =>
      filterDocsHomeVisibleFiles(files, {
        hiddenFileIds: actions.hiddenFileIds,
        isStarredView,
        starsReady: actions.starsReady,
        starredPaths: actions.starredPaths,
      }),
    [actions.hiddenFileIds, actions.starredPaths, actions.starsReady, files, isStarredView],
  );

  const emptyMessage = docsHomeEmptyMessage(view, labels);
  const emptyIconKind = docsHomeEmptyIconKind(view);

  const selectView = useCallback((next: DocsHomeView) => {
    setView(next);
    if (isSidebarOverlayViewport()) {
      setSidebarOpen(false);
    }
  }, []);

  const { primaryItems, driveItems } = useDocsHomeSidebarModel({
    labels,
    drives,
    view,
    selectView,
  });

  const handleOpenFile = useCallback(
    (file: DriveFile) => {
      if (!canOpenOffline(file)) return;
      if (file.apiPath) onOpenFile?.(file.apiPath);
    },
    [canOpenOffline, onOpenFile],
  );

  const createDialog = useDocsHomeCreateDialog({
    username,
    onCreateDocument,
    browsePathPrefix,
    listingOperations,
    files,
    groupRootNames,
  });

  return (
    <DocsHomeWorkspaceFrame
      className={className}
      session={session}
      onLogout={onLogout}
      sidebarOpen={sidebarOpen}
      onCloseSidebar={() => setSidebarOpen(false)}
      onToggleSidebar={() => setSidebarOpen((open) => !open)}
      showNewDocument={Boolean(onCreateDocument)}
      primaryItems={primaryItems}
      driveItems={driveItems}
      labels={labels}
      headerTitle={headerTitle}
      emptyMessage={emptyMessage}
      emptyIconKind={emptyIconKind}
      syncingOffline={docsBodySyncProgress.running}
      visibleFiles={visibleFiles}
      loading={listing.loading}
      loadingMore={listing.loadingMore}
      hasMore={listing.hasMore}
      error={listing.error}
      offlinePendingSyncIds={offlineBadgePendingIds}
      query={query}
      onQueryChange={setQuery}
      searchEnabled={searchEnabled}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onLoadMore={listing.loadMore}
      onOpenFile={handleOpenFile}
      actions={actions}
      inTrashView={isTrashView}
      operations={operations}
      shareOperations={shareOperations}
      username={username}
      labeledGroupRoots={labeledGroupRoots}
      files={files}
      createDialog={createDialog}
    />
  );
}
