import { useCallback, useEffect, useMemo, useState } from "react";
import { DOCS_VIEW_MODE_STORAGE_KEY } from "@/hooks/persisted-view-mode";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import { Plus } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { Button } from "@/button/src/button";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { workspaceUserInitials, type WorkspaceSession } from "@/lib/workspace/workspace-session";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";
import { cn } from "@/lib/utils";
import { mergeDocsLabels, type DocsUILabels } from "@/docs-core/src/docs-labels";
import { useDocumentTitle } from "@/lib/document-title";
import { DocsHomePane } from "@/docs-core/src/docs-home-pane";
import { useDocsHomeList, type DocsHomeFetcher } from "@/docs-core/src/use-docs-home-list";
import { useDocsHomeSharedList } from "@/docs-core/src/use-docs-home-shared-list";
import {
  useDocsHomeOfflineAvailability,
  useDocsHomeOpenGuard,
} from "@/docs-core/src/use-docs-home-offline-availability";
import {
  buildDocsHomeDrives,
  collectGroupRoots,
  fetchGroupRootsFromDrive,
  mergeGroupRoots,
  resolveDocsHomeCreateDialogBrowsePath,
  resolveNewDocumentName,
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

  const { online } = useConnectivity();
  const searchEnabled = !offlineUsername || online;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = usePersistedViewMode({
    storageKey: DOCS_VIEW_MODE_STORAGE_KEY,
    defaultMode: "list",
  });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<DocsHomeView>({ type: "all" });
  const [knownGroupRoots, setKnownGroupRoots] = useState<string[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogDefaultName, setCreateDialogDefaultName] = useState("Untitled.md");

  const isSharedView = view.type === "shared";
  const isAllView = view.type === "all";
  const browsePathPrefix = docsHomeBrowsePathPrefix(view);
  const includeSharedInListing = isAllView || isSharedView;

  useDocumentTitle(isSharedView ? labels.homeSharedWithMe : labels.homeTitle);

  const browseList = useDocsHomeList({
    username,
    query,
    pathPrefix: browsePathPrefix,
    fetcher,
    offlineUsername,
    enabled: !isSharedView,
  });

  const sharedList = useDocsHomeSharedList({
    username,
    shareOperations,
    // Prefetch whenever shares are available so All docs can merge them in.
    enabled: Boolean(shareOperations),
    query: includeSharedInListing ? query : "",
  });

  const files = useMemo(() => {
    if (isSharedView) return sharedList.files;
    if (isAllView) return mergeDocsHomeBrowseWithShared(browseList.files, sharedList.files);
    return browseList.files;
  }, [browseList.files, isAllView, isSharedView, sharedList.files]);

  // All docs waits for shared-with-me so rows don't remount when shares merge in.
  const loading = isSharedView
    ? sharedList.loading
    : isAllView && shareOperations
      ? browseList.loading || sharedList.loading
      : browseList.loading;
  const loadingMore = isSharedView ? false : browseList.loadingMore;
  const hasMore = isSharedView ? false : browseList.hasMore;
  const error = isSharedView ? sharedList.error : browseList.error;
  const loadMore = browseList.loadMore;
  const reloadBrowse = browseList.reload;
  const reloadShared = sharedList.reload;
  const reload = useCallback(() => {
    reloadBrowse();
    reloadShared();
  }, [reloadBrowse, reloadShared]);
  const isOfflineListing = isSharedView ? false : browseList.isOfflineListing;

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

  const actions = useDocsHomeActions({
    operations: driveOperations ?? operations,
    files,
    username,
    groupRoots: knownGroupRoots,
    offlineUsername,
    onAvailabilityChanged: refresh,
    reload,
  });

  const visibleFiles = useMemo(
    () => files.filter((file) => !actions.hiddenFileIds.has(file.id)),
    [actions.hiddenFileIds, files],
  );

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
    const discovered = collectGroupRoots(files);
    if (discovered.length === 0) return;
    setKnownGroupRoots((prev) => mergeGroupRoots(prev, discovered));
  }, [files]);

  const drives = useMemo(
    () => buildDocsHomeDrives(username, knownGroupRoots, labels.homeMyDrive),
    [username, knownGroupRoots, labels.homeMyDrive],
  );

  const selectView = useCallback((next: DocsHomeView) => {
    setView(next);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
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

  const groupRootNames = useMemo(() => new Set(knownGroupRoots), [knownGroupRoots]);
  const createDialogBrowsePath = useMemo(
    () => resolveDocsHomeCreateDialogBrowsePath(browsePathPrefix ?? null),
    [browsePathPrefix],
  );
  const createDialogView = useMemo(
    () => ({ type: "folder" as const, path: createDialogBrowsePath }),
    [createDialogBrowsePath],
  );

  const handleCreateDocument = useCallback(() => {
    const handle = username.trim();
    if (!handle || !onCreateDocument) return;
    const browsePath = resolveDocsHomeCreateDialogBrowsePath(browsePathPrefix ?? null);
    const apiRoot = apiPathFromUiPath(browsePath, username, groupRootNames);
    void (async () => {
      const name = await resolveNewDocumentName(driveOperations ?? operations, apiRoot, files);
      setCreateDialogDefaultName(name);
      setCreateDialogOpen(true);
    })();
  }, [
    browsePathPrefix,
    driveOperations,
    files,
    groupRootNames,
    onCreateDocument,
    operations,
    username,
  ]);

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
            title={isSharedView ? labels.homeSharedWithMe : labels.homeTitle}
            emptyMessage={isSharedView ? labels.homeSharedEmpty : labels.homeEmpty}
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
        groupRoots={knownGroupRoots}
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
