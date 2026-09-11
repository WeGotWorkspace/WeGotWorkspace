import { useCallback, useEffect, useMemo, useState } from "react";
import { DOCS_VIEW_MODE_STORAGE_KEY } from "@/hooks/persisted-view-mode";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import { Clock, Plus, Share, Star, Trash2 } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { Button } from "@/button/src/button";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import { workspaceUserInitials, type WorkspaceSession } from "@/lib/workspace/workspace-session";
import { wgwFetch, wgwIsGuestSession, wgwLiveApiEnabled, wgwReadJson } from "@/lib/api/wgw/http";
import { cn } from "@/lib/utils";
import { mergeDocsLabels, type DocsUILabels } from "@/docs-core/src/docs-labels";
import { useDocumentTitle } from "@/lib/document-title";
import { DocsHomePane } from "@/docs-core/src/docs-home-pane";
import { useDocsHomeList, type DocsHomeFetcher } from "@/docs-core/src/use-docs-home-list";
import { useDocsHomeSharedList } from "@/docs-core/src/use-docs-home-shared-list";
import { useDocsHomeStarredList } from "@/docs-core/src/use-docs-home-starred-list";
import { useDocsHomeTrashList } from "@/docs-core/src/use-docs-home-trash-list";
import {
  useDocsHomeOfflineAvailability,
  useDocsHomeOpenGuard,
} from "@/docs-core/src/use-docs-home-offline-availability";
import {
  applyDocsHomeGroupDisplayNames,
  buildDocsHomeDrives,
  collectGroupRoots,
  DOCS_DRIVE_UI_PERSONAL_PATH,
  fetchGroupRootsFromDrive,
  mergeGroupRoots,
  resolveDocsHomeCreateDialogBrowsePath,
  resolveNewDocumentName,
  type DocsHomeGroupRoot,
} from "@/docs-core/src/docs-home-drives";
import {
  docsHomeBrowsePathPrefix,
  mergeDocsHomeBrowseWithShared,
  type DocsHomeView,
} from "@/docs-core/src/docs-home-shared";
import { useDocsHomeSidebarModel } from "@/docs-core/src/use-docs-home-sidebar-model";
import { useDocsHomeActions } from "@/docs-core/src/use-docs-home-actions";
import { DocsHomeModals } from "@/docs-core/src/docs-home-modals";
import type { DriveAPIOperations, DriveShareOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { apiPathFromUiPath, normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
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
  const [knownGroupRoots, setKnownGroupRoots] = useState<DocsHomeGroupRoot[]>([]);
  const [groupDirectory, setGroupDirectory] = useState<
    readonly { id: string; displayName: string }[]
  >([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogDefaultName, setCreateDialogDefaultName] = useState("Untitled.md");
  const [createDialogBrowsePath, setCreateDialogBrowsePath] = useState(DOCS_DRIVE_UI_PERSONAL_PATH);

  const labeledGroupRoots = useMemo(
    () => applyDocsHomeGroupDisplayNames(knownGroupRoots, groupDirectory),
    [groupDirectory, knownGroupRoots],
  );

  const isSharedView = view.type === "shared";
  const isAllView = view.type === "all";
  const isRecentView = view.type === "recent";
  const isStarredView = view.type === "starred";
  const isTrashView = view.type === "trash";
  const isDriveView = view.type === "drive";
  const browsePathPrefix = docsHomeBrowsePathPrefix(view);
  const includeSharedInListing = isAllView || isSharedView;
  const usesBrowseList = isAllView || isRecentView || isDriveView;

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

  const files = useMemo(() => {
    if (isSharedView) return sharedList.files;
    if (isStarredView) return starredList.files;
    if (isTrashView) return trashList.files;
    if (isAllView) return mergeDocsHomeBrowseWithShared(browseList.files, sharedList.files);
    // Recent + drive: browse only (recent is modified-desc across drives; no shared merge).
    return browseList.files;
  }, [
    browseList.files,
    isAllView,
    isSharedView,
    isStarredView,
    isTrashView,
    sharedList.files,
    starredList.files,
    trashList.files,
  ]);

  // All docs waits for shared-with-me so rows don't remount when shares merge in.
  const loading = isSharedView
    ? sharedList.loading
    : isStarredView
      ? starredList.loading
      : isTrashView
        ? trashList.loading
        : isAllView && shareOperations
          ? browseList.loading || sharedList.loading
          : browseList.loading;
  const loadingMore = usesBrowseList ? browseList.loadingMore : false;
  const hasMore = usesBrowseList ? browseList.hasMore : false;
  const error = isSharedView
    ? sharedList.error
    : isStarredView
      ? starredList.error
      : isTrashView
        ? trashList.error
        : browseList.error;
  const loadMore = browseList.loadMore;
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
  const isOfflineListing = usesBrowseList ? browseList.isOfflineListing : false;

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
  const offlineSyncingIds = useMemo(() => {
    if (!docsBodySyncProgress.running) return new Set<string>();
    return new Set(
      files.filter((file) => !offlineAvailableIds.has(file.id)).map((file) => file.id),
    );
  }, [docsBodySyncProgress.running, files, offlineAvailableIds]);

  const offlineBadgePendingIds = useMemo(() => {
    if (offlineSyncingIds.size === 0) return offlinePendingSyncIds;
    const merged = new Set(offlinePendingSyncIds);
    for (const id of offlineSyncingIds) merged.add(id);
    return merged;
  }, [offlinePendingSyncIds, offlineSyncingIds]);

  const canOpenOffline = useDocsHomeOpenGuard({
    isOfflineListing,
    offlineAvailableIds,
    onUnavailable: () => showError(labels.homeNotAvailableOffline),
  });

  useEffect(() => {
    if (!operations || !online) return;
    const controller = new AbortController();
    void fetchGroupRootsFromDrive(operations, { signal: controller.signal }).then((discovered) => {
      if (discovered.length === 0) return;
      setKnownGroupRoots((prev) => mergeGroupRoots(prev, discovered));
    });
    return () => controller.abort();
  }, [operations, online]);

  useEffect(() => {
    if (!online || !wgwLiveApiEnabled()) return;
    const controller = new AbortController();
    void wgwFetch("/settings/state", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await wgwReadJson(res)) as {
          groups?: { id: string; displayName: string }[];
        };
        if (Array.isArray(json.groups)) setGroupDirectory(json.groups);
      })
      .catch(() => {
        /* best-effort labels only */
      });
    return () => controller.abort();
  }, [online]);

  useEffect(() => {
    const discovered = collectGroupRoots(files);
    if (discovered.length === 0) return;
    // mergeGroupRoots returns `prev` when slug/label sets are unchanged so
    // setState bails out — otherwise labeledGroupRoots remaps files forever.
    setKnownGroupRoots((prev) => mergeGroupRoots(prev, discovered));
  }, [files]);

  const groupRootSlugs = useMemo(
    () => labeledGroupRoots.map((root) => root.slug),
    [labeledGroupRoots],
  );

  const drives = useMemo(
    () => buildDocsHomeDrives(username, labeledGroupRoots, labels.homeMyDrive),
    [username, labeledGroupRoots, labels.homeMyDrive],
  );

  const selectedDriveLabel = useMemo(() => {
    if (!isDriveView) return null;
    return drives.find((drive) => drive.pathPrefix === view.pathPrefix)?.label ?? null;
  }, [drives, isDriveView, view]);

  const headerTitle = isSharedView
    ? labels.homeSharedWithMe
    : isRecentView
      ? labels.homeRecent
      : isStarredView
        ? labels.homeStarred
        : isTrashView
          ? labels.homeTrash
          : (selectedDriveLabel ?? labels.homeTitle);

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

  const visibleFiles = useMemo(() => {
    const notHidden = files.filter((file) => !actions.hiddenFileIds.has(file.id));
    if (!isStarredView) return notHidden;
    // Keep Starred rows until listStars settles; then drop optimistic unstars.
    if (!actions.starsReady) return notHidden;
    return notHidden.filter((file) => {
      const apiPath = file.apiPath ? normalizeApiVirtualPath(file.apiPath) : null;
      return apiPath ? actions.starredPaths.has(apiPath) : false;
    });
  }, [actions.hiddenFileIds, actions.starredPaths, actions.starsReady, files, isStarredView]);

  const emptyMessage = isSharedView
    ? labels.homeSharedEmpty
    : isRecentView
      ? labels.homeRecentEmpty
      : isStarredView
        ? labels.homeStarredEmpty
        : isTrashView
          ? labels.homeTrashEmpty
          : labels.homeEmpty;

  const emptyIcon = isSharedView ? (
    <Share className="size-12" />
  ) : isRecentView ? (
    <Clock className="size-12" />
  ) : isStarredView ? (
    <Star className="size-12" />
  ) : isTrashView ? (
    <Trash2 className="size-12" />
  ) : undefined;

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

  const groupRootNames = useMemo(
    () => new Set(labeledGroupRoots.map((root) => root.slug)),
    [labeledGroupRoots],
  );
  const createDialogView = useMemo(
    () => ({ type: "folder" as const, path: createDialogBrowsePath }),
    [createDialogBrowsePath],
  );

  const handleCreateDocument = useCallback(() => {
    const handle = username.trim();
    if (!handle || !onCreateDocument) return;
    // Freeze the sidebar drive at click time (path key stays "My Drive" / "Groups/…").
    const browsePath = resolveDocsHomeCreateDialogBrowsePath(browsePathPrefix ?? null);
    setCreateDialogBrowsePath(browsePath);
    const apiRoot = apiPathFromUiPath(browsePath, username, groupRootNames);
    void (async () => {
      const name = await resolveNewDocumentName(listingOperations, apiRoot, files);
      setCreateDialogDefaultName(name);
      setCreateDialogOpen(true);
    })();
  }, [browsePathPrefix, files, groupRootNames, listingOperations, onCreateDocument, username]);

  const closeCreateDialog = useCallback(() => {
    setCreateDialogOpen(false);
  }, []);

  const confirmCreateDocument = useCallback(
    (name: string, destinationPath: string) => {
      if (!onCreateDocument) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const cwd = apiPathFromUiPath(destinationPath, username, groupRootNames);
      const apiPath = normalizeApiVirtualPath(`${cwd}/${trimmed}`);
      setCreateDialogOpen(false);
      onCreateDocument(apiPath);
    },
    [groupRootNames, onCreateDocument, username],
  );

  return (
    <TooltipProvider delayDuration={200}>
      <WorkspaceAppLayout
        className={cn("docs-workspace docs-home-workspace", className)}
        sidebar={
          <AppSidebar
            open={sidebarOpen}
            onCloseMobile={() => setSidebarOpen(false)}
            appSwitchDisabled={wgwIsGuestSession()}
            appSwitchSubtitle="Docs"
            primaryButton={
              onCreateDocument ? (
                <Button
                  label={labels.homeNewDocument}
                  icon={<Plus />}
                  size="lg"
                  pill
                  variant="primary"
                  className="w-full"
                  onClick={handleCreateDocument}
                />
              ) : undefined
            }
            footer={
              <WorkspaceUserFooter
                name={session.user.displayName}
                initials={workspaceUserInitials(session.user)}
                detailLine={session.user.username}
                onLogoutClick={onLogout}
              />
            }
          >
            <SidebarSection items={primaryItems} />
            {driveItems.length > 0 ? (
              <SidebarSection title={labels.homeDrivesSection} items={driveItems} />
            ) : null}
          </AppSidebar>
        }
        main={
          <DocsHomePane
            labels={labels}
            title={headerTitle}
            emptyMessage={emptyMessage}
            emptyIcon={emptyIcon}
            files={visibleFiles}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            error={error}
            offlinePendingSyncIds={offlineBadgePendingIds}
            offlineLabels={{
              ...labels,
              offlinePendingSync: docsBodySyncProgress.running
                ? labels.syncingOffline
                : labels.offlinePendingSync,
            }}
            query={query}
            onQueryChange={setQuery}
            searchEnabled={searchEnabled}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onLoadMore={loadMore}
            onOpenFile={handleOpenFile}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            starred={actions.starred}
            onStar={actions.onStar}
            onDownload={actions.onDownload}
            onRename={actions.onRename}
            onMove={actions.onMove}
            onTrash={actions.onTrash}
            inTrashView={isTrashView}
            operations={operations}
            batchStar={actions.batchStar}
            requestMoveSelected={actions.requestMoveSelected}
            requestDeleteSelected={actions.requestDeleteSelected}
            onUndoQueuedAction={actions.undoLatest}
            shareOperations={shareOperations}
            username={username}
          />
        }
      />
      <DocsHomeModals
        actions={actions}
        labels={labels}
        files={files}
        username={username}
        groupRoots={labeledGroupRoots}
        operations={operations}
        createDialogOpen={createDialogOpen}
        createDialogDefaultName={createDialogDefaultName}
        createDialogBrowsePath={createDialogBrowsePath}
        createDialogView={createDialogView}
        onCloseCreateDialog={closeCreateDialog}
        onConfirmCreateDocument={confirmCreateDocument}
      />
    </TooltipProvider>
  );
}
