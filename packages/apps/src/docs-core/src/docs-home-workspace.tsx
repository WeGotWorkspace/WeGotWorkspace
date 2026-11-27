import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import { cn } from "@/lib/utils";
import { DOCS_VIEW_MODE_STORAGE_KEY } from "@/hooks/persisted-view-mode";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import { dismissSidebarOverlay } from "@/workspace-shell/src/sidebar-breakpoint";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { mergeDocsLabels, type DocsUILabels } from "@/docs-core/src/docs-labels";
import { useDocumentTitle } from "@/lib/document-title";
import { type DocsHomeFetcher } from "@/lib/files/docs-home-listing";
import { useDocsHomeRows } from "@/docs-core/src/use-docs-home-rows";
import { docsHomeWorkspaceConfig } from "@/docs-core/src/docs-home-config";
import {
  useDocsHomeOfflineAvailability,
  useDocsHomeOpenGuard,
} from "@/docs-core/src/use-docs-home-offline-availability";
import { docsHomeBrowsePathPrefix, type DocsHomeView } from "@/docs-core/src/docs-home-shared";
import { useDocsProjectScope } from "@/docs-core/src/use-docs-project-scope";
import { useProjects } from "@/lib/projects/projects-store";
import { useSelectedProjectIds } from "@/lib/projects/use-project-filter";
import { useDocsHomeSidebarModel } from "@/docs-core/src/use-docs-home-sidebar-model";
import { useDocsHomeActions } from "@/docs-core/src/use-docs-home-actions";
import { useDocsHomeGroupRoots } from "@/docs-core/src/use-docs-home-group-roots";
import { useDocsHomeCreateDialog } from "@/docs-core/src/use-docs-home-create-dialog";
import {
  docsHomeEmptyIconKind,
  docsHomePaneOfflineLabels,
  docsHomeOfflineBadgePendingIds,
  docsHomeOfflineSyncingIds,
  filterDocsHomeVisibleFiles,
} from "@/docs-core/src/docs-home-workspace-model";
import { DocsHomePane } from "@/docs-core/src/docs-home-pane";
import { DocsHomeModals } from "@/docs-core/src/docs-home-modals";
import { DocsHomeSidebar } from "@/docs-core/src/docs-home-sidebar";
import { docsHomeEmptyIcon } from "@/docs-core/src/docs-home-empty-icon";
import type { DriveAPIOperations, DriveShareOperations } from "@/lib/files/drive-types";
import type { DriveFile } from "@/lib/files/drive-models";
import { createDocsFileOperations } from "@/lib/offline/docs/docs-file-operations";
import { getDocsSyncRunner } from "@/lib/offline/docs/docs-sync-runner";
import { getDriveSyncRunner } from "@/lib/offline/drive/drive-hybrid-operations";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";
import { setDriveSyncConflictListener } from "@/lib/offline/drive/drive-sync-conflicts";
import { readDocsBodySyncProgress } from "@/lib/offline/docs/docs-body-sync";
import { useOfflineBodySyncRunning } from "@/lib/offline/core/use-offline-body-sync-running";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { setDocsSyncConflictListener } from "@/lib/offline/docs/docs-sync-conflicts";
import { useDomainOutboxNotice } from "@/lib/offline/core/use-domain-outbox-notice";
import { useDriveFileNodeInbound } from "@/drive-core/src/use-drive-file-node-inbound";
import { useOfflineReconnectFlush } from "@/hooks/use-offline-reconnect-flush";
import { subscribeDocsCachesChanged } from "@/lib/offline/docs/docs-inbound-sync";
import { useOfflineSyncToast } from "@/hooks/use-offline-sync-toast";
import { NoticeBar } from "@/notice-bar/src/notice-bar";
import { useSyncRetryNotice } from "@/notice-bar/src/use-sync-retry-notice";
import { useImportWordFile } from "@/docs-core/src/docx-import/use-import-word-file";
import { WordFilePickerInput } from "@/docs-core/src/docx-import/word-file-picker-input";
import { useSaveAsMarkdownAction } from "@/docs-core/src/docx-import/use-save-as-markdown-action";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";
import "@/docs-core/src/docs-workspace.css";
import "@/docs-core/src/docs-home-workspace.css";

export type DocsHomeWorkspaceProps = {
  session: WorkspaceSession;
  /**
   * Content search (`/search/results`); without `offlineUsername` (Storybook,
   * Vitest) it also lists All Docs, Recent and the drives.
   */
  fetcher?: DocsHomeFetcher;
  /**
   * The account whose local file tree Docs home lists (live app only, #2063 C4).
   * Its writes then go through Drive's hybrid operations.
   */
  offlineUsername?: string | null;
  /** Live drive operations powering row actions (star/download/rename/move/trash). */
  operations?: DriveAPIOperations;
  /** When set, enables Share in docs home row action menus. */
  shareOperations?: DriveShareOperations;
  /**
   * Called with the drive API path when a row is opened (route navigation lives in `*App`),
   * plus the FileNode id when the row names one, so Docs opens `?id=` directly (#1976).
   */
  onOpenFile?: (apiPath: string, nodeId?: string) => void;
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
  const { show, showError } = useAppToast();
  const offlineUsername = offlineUsernameProp;

  // One operations layer (#2063 C4): Drive's hybrid operations, with the Docs hooks.
  const driveOperations = useMemo(
    () => (offlineUsername ? createDocsFileOperations(offlineUsername) : operations),
    [offlineUsername, operations],
  );
  const listingOperations = driveOperations ?? operations;
  // The selection bar zips on the server, so it needs the hybrid's offline error;
  // single-item downloads stay as the pane received them.
  const paneOperations = useMemo(
    () =>
      operations && driveOperations?.downloadSelection
        ? { ...operations, downloadSelection: driveOperations.downloadSelection }
        : operations,
    [operations, driveOperations],
  );

  const { online } = useConnectivity();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = usePersistedViewMode({
    storageKey: DOCS_VIEW_MODE_STORAGE_KEY,
    defaultMode: "list",
  });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<DocsHomeView>({ type: "all" });

  const { labeledGroupRoots, drives, groupRootSlugs, discoverFromFiles } = useDocsHomeGroupRoots({
    username,
    personalDriveLabel: labels.homeMyDrive,
    operations,
    online,
  });

  const isTrashView = view.type === "trash";
  const isStarredView = view.type === "starred";
  const browsePathPrefix = docsHomeBrowsePathPrefix(view);

  const selectView = useCallback((next: DocsHomeView) => {
    setView(next);
    dismissSidebarOverlay(() => setSidebarOpen(false));
  }, []);
  const projectDrives = useDocsProjectScope({ drives, view, selectView });
  const config = useMemo(
    () => docsHomeWorkspaceConfig({ labels, username, drives: projectDrives }),
    // `labels` is rebuilt every render from the same overrides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labelOverrides, username, projectDrives],
  );

  const listing = useDocsHomeRows({
    config,
    treeUsername: offlineUsername,
    username,
    view,
    query,
    online,
    personalDriveLabel: labels.homeMyDrive,
    groupRoots: labeledGroupRoots,
    fetcher,
    operations: listingOperations,
    shareOperations,
  });
  const files = listing.files;
  const reload = listing.reload;

  const { offlineAvailableIds, offlinePendingSyncIds, refresh } = useDocsHomeOfflineAvailability(
    files,
    Boolean(offlineUsername),
    offlineUsername,
  );

  const [outboxNoticeKey, setOutboxNoticeKey] = useState(0);
  // "Changes synced" only when this reconnect's queued changes all reached the server.
  const flushLandedRef = useRef(false);
  const syncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      flushLandedRef.current = false;
      if (!offlineUsername) return;
      // Docs home writes queue in the Drive outbox; the editor's creates in the Docs one.
      const docs = await getDocsSyncRunner(offlineUsername).flush();
      const drive = await getDriveSyncRunner(offlineUsername).flush();
      const flushed = (docs?.flushed ?? 0) + (drive?.flushed ?? 0);
      const failed = (docs?.failed ?? 0) + (drive?.failed ?? 0);
      flushLandedRef.current = flushed > 0 && failed === 0;
    },
    afterFlush: async () => {
      await refresh();
      // The lists and stars may have been read before the queued writes landed.
      reload();
      setOutboxNoticeKey((key) => key + 1);
    },
  });
  const docsOutboxNotice = useDomainOutboxNotice({
    username: offlineUsername,
    domain: DOCS_DOMAIN,
    setConflictListener: setDocsSyncConflictListener,
    refreshKey: outboxNoticeKey,
  });
  const driveOutboxNotice = useDomainOutboxNotice({
    username: offlineUsername,
    domain: DRIVE_DOMAIN,
    setConflictListener: setDriveSyncConflictListener,
    refreshKey: outboxNoticeKey,
  });
  const outboxNoticeActive = docsOutboxNotice.active || driveOutboxNotice.active;
  const clearDocsConflicts = docsOutboxNotice.clearConflicts;
  const clearDriveConflicts = driveOutboxNotice.clearConflicts;
  const retryFailedOutbox = useCallback(async () => {
    clearDocsConflicts();
    clearDriveConflicts();
    if (!offlineUsername) return;
    await Promise.all([
      getDocsSyncRunner(offlineUsername).flush(),
      getDriveSyncRunner(offlineUsername).flush(),
    ]).finally(() => setOutboxNoticeKey((key) => key + 1));
  }, [clearDocsConflicts, clearDriveConflicts, offlineUsername]);
  const syncNotice = useSyncRetryNotice({
    id: "sync:docs",
    active: Boolean(offlineUsername) && outboxNoticeActive,
    title: labels.syncFailedNotice,
    retryLabel: labels.retrySync,
    onRetry: retryFailedOutbox,
  });
  // FileNode/changes keeps the tree current; the tree views re-read on their own (#1663).
  // Until this page's first pull settled a row's id may be stale (deleted and
  // made again elsewhere): such a row opens by path, as a cached listing row did.
  const [treePulled, setTreePulled] = useState(false);
  const markTreePulled = useCallback(() => setTreePulled(true), []);
  useDriveFileNodeInbound(offlineUsername, outboxNoticeKey, markTreePulled);
  // A Docs cache change from any tab (a star, a landed queued write): read the stars again.
  const [docsCacheNoticeKey, setDocsCacheNoticeKey] = useState(0);
  useEffect(
    () =>
      offlineUsername
        ? subscribeDocsCachesChanged(offlineUsername, () => setDocsCacheNoticeKey((key) => key + 1))
        : undefined,
    [offlineUsername],
  );

  const bodySyncDoneRef = useRef(-1);
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
    return readDocsBodySyncProgress(offlineUsername).then((progress) => {
      // A run over many Docs takes a while: each body it stores drops that
      // row's "Syncing offline" badge now, not when the whole run ends.
      const done = progress.synced + progress.failed;
      if (done !== bodySyncDoneRef.current) {
        bodySyncDoneRef.current = done;
        refresh();
      }
      return progress;
    });
  }, [offlineUsername, refresh]);

  const docsBodySyncRunning = useOfflineBodySyncRunning({
    enabled: Boolean(offlineUsername),
    readProgress: readBodySyncProgress,
  });

  useOfflineSyncToast(syncing, labels.toastSynced, () => flushLandedRef.current);

  useEffect(() => {
    if (online && offlineUsername) refresh();
  }, [online, offlineUsername, refresh]);

  /** Row badge dots: only pending body sync or unsaved/outbox/collab — never green "available offline". */
  const offlineSyncingIds = useMemo(
    () => docsHomeOfflineSyncingIds(files, docsBodySyncRunning, offlineAvailableIds),
    [docsBodySyncRunning, files, offlineAvailableIds],
  );
  const offlineBadgePendingIds = useMemo(
    () => docsHomeOfflineBadgePendingIds(offlinePendingSyncIds, offlineSyncingIds),
    [offlinePendingSyncIds, offlineSyncingIds],
  );

  const canOpenOffline = useDocsHomeOpenGuard({
    isOfflineListing: listing.isOfflineListing,
    offlineAvailableIds,
    username: offlineUsername,
    onUnavailable: () => showError(labels.homeNotAvailableOffline),
  });

  // Discover roots after `files` exists. The browse list already used the previous pass.
  useEffect(() => {
    discoverFromFiles(files);
  }, [discoverFromFiles, files]);

  const actions = useDocsHomeActions({
    operations: listingOperations,
    files,
    username,
    groupRoots: groupRootSlugs,
    offlineUsername,
    onAvailabilityChanged: refresh,
    reload,
    inTrashView: isTrashView,
    starsRefreshKey: outboxNoticeKey + docsCacheNoticeKey,
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

  const emptyMessage = config.emptyMessage(view);
  const emptyIconKind = docsHomeEmptyIconKind(view);

  const headerTitle = config.title(view);
  useDocumentTitle(headerTitle);

  const { projects } = useProjects();
  const selectedProjectIds = useSelectedProjectIds();
  const { primaryItems, driveItems, projectItems } = useDocsHomeSidebarModel({
    labels,
    drives: projectDrives,
    view,
    selectView,
    projects,
    selectedProjectIds,
  });

  const handleOpenFile = useCallback(
    (file: DriveFile) => {
      const action = config.openFile(file);
      if (action.kind === "notice") {
        show(action.message);
        return;
      }
      if (!file.apiPath) return;
      const apiPath = file.apiPath;
      // Offline the tree is all there is, so its id is the best answer. The
      // snapshot counts too: right after the connection drops, `online` may
      // still say true, and an open by path then needs the server.
      const offlineNow = !online || !getConnectivitySnapshot();
      const trustId = treePulled || offlineNow || !offlineUsername;
      void canOpenOffline(file).then((open) => {
        if (open) onOpenFile?.(apiPath, trustId ? file.nodeId : undefined);
      });
    },
    [canOpenOffline, config, offlineUsername, online, onOpenFile, show, treePulled],
  );

  const saveAsMarkdown = useSaveAsMarkdownAction({
    enabled: Boolean(onCreateDocument) && !isTrashView && !wgwIsGuestSession(),
    onOpenDocsFile: onOpenFile,
    username,
    dialogSurfaceClassName: "docs-dialog-surface",
  });

  const importWordFile = useImportWordFile({
    enabled: Boolean(onCreateDocument) && !wgwIsGuestSession(),
    onOpenDocsFile: onOpenFile,
    dialogSurfaceClassName: "docs-dialog-surface",
  });

  const createDialog = useDocsHomeCreateDialog({
    username,
    onCreateDocument,
    onImportWordFiles: importWordFile.importFiles,
    browsePathPrefix,
    listingOperations,
    files,
    groupRootSlugs,
  });

  const { handleCreateDocument } = createDialog;
  const handleNewDocument = useCallback(() => {
    const jumpTo = config.createJumpsTo(view);
    if (jumpTo) selectView(jumpTo);
    handleCreateDocument();
  }, [config, handleCreateDocument, selectView, view]);

  return (
    <TooltipProvider delayDuration={200}>
      <WorkspaceAppLayout
        className={cn("docs-workspace docs-home-workspace", className)}
        sidebar={
          <DocsHomeSidebar
            open={sidebarOpen}
            onCloseMobile={() => setSidebarOpen(false)}
            showNewDocument={Boolean(onCreateDocument)}
            onNewDocument={handleNewDocument}
            newDocumentLabel={labels.homeNewDocument}
            newDocumentMenuLabel={labels.homeNewDocumentMenu}
            newDocumentMenuItems={importWordFile.menuItems}
            session={session}
            onLogout={onLogout}
            primaryItems={primaryItems}
            driveItems={driveItems}
            drivesSectionLabel={labels.homeDrivesSection}
            projectItems={projectItems}
            projectsSectionLabel={labels.homeProjectsSection}
          />
        }
        main={
          <DocsHomePane
            labels={labels}
            title={headerTitle}
            emptyMessage={emptyMessage}
            emptyIcon={docsHomeEmptyIcon(emptyIconKind)}
            files={visibleFiles}
            loading={listing.loading}
            viewState={listing.viewState}
            loadingMore={listing.loadingMore}
            hasMore={listing.hasMore}
            error={listing.error}
            notice={<NoticeBar label={labels.noticeBarLabel} notices={[syncNotice]} />}
            offlinePendingSyncIds={offlineBadgePendingIds}
            offlineLabels={docsHomePaneOfflineLabels(labels, docsBodySyncRunning)}
            query={query}
            onQueryChange={setQuery}
            searchEnabled
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onLoadMore={listing.loadMore}
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
            operations={paneOperations}
            batchStar={actions.batchStar}
            requestMoveSelected={actions.requestMoveSelected}
            requestDeleteSelected={actions.requestDeleteSelected}
            onUndoQueuedAction={actions.undoLatest}
            shareOperations={shareOperations}
            username={username}
            extraFileActions={saveAsMarkdown.actionsFor}
          />
        }
      />
      <DocsHomeModals
        actions={actions}
        labels={labels}
        files={files}
        username={username}
        groupRoots={labeledGroupRoots}
        operations={listingOperations}
        createDialog={createDialog}
      />
      {saveAsMarkdown.dialogs}
      {importWordFile.dialogs}
      <WordFilePickerInput
        inputRef={importWordFile.inputRef}
        onPick={createDialog.handleImportWordFiles}
      />
    </TooltipProvider>
  );
}
