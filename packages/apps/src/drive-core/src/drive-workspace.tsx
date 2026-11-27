import { useProjects } from "@/lib/projects/projects-store";
import { useSelectedProjectIds } from "@/lib/projects/use-project-filter";
import { useDriveProjectScope } from "@/drive-core/src/use-drive-project-scope";
import { TooltipProvider } from "@/ui/tooltip";
import { useCallback, useMemo, useState } from "react";
import { ChevronRight, Download, PanelRight } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { useAppToast } from "@/hooks/use-app-toast";
import { NoticeBar } from "@/notice-bar/src/notice-bar";
import { useSyncRetryNotice } from "@/notice-bar/src/use-sync-retry-notice";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import {
  workspaceUserFooterDetailLine,
  type WorkspaceSession,
} from "@/lib/workspace/workspace-session";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";
import { ViewHeader } from "@/view-header/src/view-header";
import { PathBreadcrumb } from "@/path-breadcrumb/src/path-breadcrumb";
import { withDriveRootIcons } from "@/drive-core/src/drive-view-icons";
import { WorkspaceSidebarAccountFooter } from "@/workspace-shell/src/workspace-app-layout";
import { ViewModeToggle } from "@/view-mode-toggle/src/view-mode-toggle";
import { cn } from "@/lib/utils";
import { SideDrawer } from "@/ui/side-drawer";
import { DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS } from "@/text-editor-core/docs-collab/docs-collab-card";
import { useDocsCommentsLayout } from "@/text-editor-core/docs-collab/use-docs-comments-layout";
import { DriveDetailPanel } from "@/drive-core/src/drive-detail-panel";
import { driveItemLocationLabel } from "@/drive-core/src/drive-breadcrumbs";
import {
  DriveFolderDownloadContext,
  startDriveItemDownload,
} from "@/drive-core/src/drive-item-download";
import { DriveMainPane } from "@/drive-core/src/drive-main-pane";
import { DriveNewMenu } from "@/drive-core/src/drive-new-menu";
import { useDriveController } from "@/drive-core/src/use-drive-controller";
import { useDriveUploadPlaceholderActions } from "@/drive-core/src/use-drive-upload-placeholder-actions";
import {
  DriveUploadQueueProvider,
  useDriveUploadQueue,
  useDriveUploadQueueModel,
} from "@/drive-core/src/drive-upload-queue";
import { DriveUploadAnnouncer } from "@/drive-core/src/drive-upload-announcer";
import { useDriveUploadChooseFolder } from "@/drive-core/src/drive-upload-choose-folder";
import { useDriveUploadRetryAfterSignIn } from "@/drive-core/src/use-drive-upload-recovery";
import { useDocumentTitle } from "@/lib/document-title";
import { useDriveSidebarModel } from "@/drive-core/src/use-drive-sidebar-model";
import type { DriveWorkspaceProps } from "@/drive-core/src/drive-workspace-props";
import { DriveWorkspaceModals } from "@/drive-core/src/drive-workspace-modals";
import { useDriveShareDialog } from "@/drive-core/src/use-drive-share-dialog";
import { useDriveShareMyRights } from "@/drive-core/src/use-drive-share-my-rights";
import {
  useDriveOfflineAvailability,
  useDriveOfflineOpenGuard,
} from "@/drive-core/src/use-drive-offline-availability";
import { useDriveOfflineFileActions } from "@/drive-core/src/use-drive-offline-file-actions";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";
import { getDriveSyncRunner } from "@/lib/offline/drive/drive-hybrid-operations";
import { setDriveSyncConflictListener } from "@/lib/offline/drive/drive-sync-conflicts";
import { useDomainOutboxNotice } from "@/lib/offline/core/use-domain-outbox-notice";
import { useDriveFileNodeInbound } from "./use-drive-file-node-inbound";
import { useOfflineReconnectFlush } from "@/hooks/use-offline-reconnect-flush";
import { useOfflineSyncToast } from "@/hooks/use-offline-sync-toast";
import type { DriveFile } from "@/lib/files/drive-models";
import { isTopLevelDriveApiPath } from "@/lib/files/drive-path-utils";
import { isProjectFolderUiPath, useProjectFolders } from "@/drive-core/src/drive-project-folder";
import { resolveDriveFileCanManageStructure } from "@/drive-core/src/drive-file-structure-rights";
import { resolveDetailFilePreview } from "@/lib/file-preview/file-preview-utils";
import "@/drive-core/src/drive-workspace.css";

export function DriveWorkspace({
  data,
  session,
  operations,
  shareOperations,
  listLoading = false,
  offlineUsername = null,
  view,
  onViewChange,
  onOpenDocsFile,
  saveAsMarkdown,
  onOpenShare,
  onLogout,
  className,
}: DriveWorkspaceProps) {
  const { show, showError } = useAppToast();
  const offlineEnabled = Boolean(offlineUsername);

  const controller = useDriveController({
    data,
    session,
    operations,
    shareOperations,
    listLoading,
    view,
    onViewChange,
    onOpenDocsFile,
  });

  const shareDialog = useDriveShareDialog({
    shareOperations,
    username: controller.currentUsername,
  });

  const projectFolders = useProjectFolders();
  const activeFile = controller.active;
  const needsActiveRightsFetch = Boolean(
    shareOperations &&
    activeFile?.apiPath &&
    (activeFile.mayShare === undefined || activeFile.mayManageStructure === undefined),
  );
  const { mayShare: fetchedActiveMayShare, mayManageStructure: fetchedActiveMayManageStructure } =
    useDriveShareMyRights({
      path: activeFile?.apiPath ?? "",
      operations: shareOperations,
      enabled: needsActiveRightsFetch,
    });
  const activeMayShare = activeFile?.mayShare ?? fetchedActiveMayShare;
  const activeMayManageStructure =
    activeFile?.mayManageStructure ?? fetchedActiveMayManageStructure;

  const handleOpenShareForFile = useCallback(
    (apiPath: string, title: string) => {
      // The active item may be a file the listing does not show (opened from
      // search, say). A path outside both is the open folder or one of its parents.
      const entry =
        controller.files.find((file) => file.apiPath === apiPath) ??
        (controller.active?.apiPath === apiPath ? controller.active : undefined);
      shareDialog.openShareDialog(apiPath, title, entry ? entry.kind === "folder" : true);
      onOpenShare?.(apiPath);
    },
    [controller.active, controller.files, onOpenShare, shareDialog],
  );

  const {
    offlineAvailableIds: rowOfflineAvailableIds,
    offlinePendingSyncIds: rowOfflinePendingSyncIds,
    refresh,
  } = useDriveOfflineAvailability(controller.visibleItems, offlineEnabled, offlineUsername);

  const canOpenOffline = useDriveOfflineOpenGuard(
    controller.visibleItems,
    rowOfflineAvailableIds,
    offlineEnabled,
  );

  const { extraFileActions, pinOfflineFile, pinLoadingId } = useDriveOfflineFileActions({
    username: offlineUsername,
    offlineAvailableIds: rowOfflineAvailableIds,
    onChanged: refresh,
  });

  const uploadQueue = useDriveUploadQueue(operations);
  const chooseUploadFolder = useDriveUploadChooseFolder(controller, uploadQueue, show, showError);
  const uploadModel = useDriveUploadQueueModel(
    uploadQueue,
    operations,
    showError,
    chooseUploadFolder.choose,
  );
  useDriveUploadRetryAfterSignIn(uploadModel, operations, showError);
  const uploadPlaceholderActions = useDriveUploadPlaceholderActions(uploadModel);
  // Same gate as New Doc: the new `.md` lands next to the Word file (#1983).
  const saveAsMarkdownActionsFor =
    controller.structureEnabled && controller.uploadEnabled ? saveAsMarkdown?.actionsFor : null;
  const fileExtraActions = useCallback(
    (file: DriveFile) =>
      file.upload
        ? uploadPlaceholderActions(file)
        : [
            ...(offlineEnabled ? extraFileActions(file) : []),
            ...(saveAsMarkdownActionsFor?.(file) ?? []),
          ],
    [extraFileActions, offlineEnabled, saveAsMarkdownActionsFor, uploadPlaceholderActions],
  );

  const handleMakeOfflineAvailable = useCallback(
    (file: DriveFile) => {
      void pinOfflineFile(file);
    },
    [pinOfflineFile],
  );

  const guardedOpenFile = useCallback(
    (file: DriveFile) => {
      // A file placeholder has nothing on the server to open yet. A folder of
      // a folder upload opens: it lists what is uploading into it (#1620).
      if (file.upload && file.kind !== "folder") {
        show(driveLabels.uploadOpenUnavailable);
        return;
      }
      if (!canOpenOffline(file)) {
        showError("This file is not available offline. Make it available while online.");
        return;
      }
      controller.openFile(file);
    },
    [canOpenOffline, controller, show, showError],
  );

  const [outboxNoticeKey, setOutboxNoticeKey] = useState(0);
  const syncing = useOfflineReconnectFlush({
    enabled: offlineEnabled,
    flush: async () => {
      if (!offlineUsername) return;
      await getDriveSyncRunner(offlineUsername).flush();
    },
    afterFlush: async () => {
      await refresh();
      setOutboxNoticeKey((key) => key + 1);
    },
  });
  const { active: outboxNoticeActive, clearConflicts } = useDomainOutboxNotice({
    username: offlineUsername,
    domain: DRIVE_DOMAIN,
    setConflictListener: setDriveSyncConflictListener,
    refreshKey: outboxNoticeKey,
  });
  const retryFailedOutbox = useCallback(async () => {
    clearConflicts();
    if (!offlineUsername) return;
    await getDriveSyncRunner(offlineUsername)
      .flush()
      .finally(() => setOutboxNoticeKey((key) => key + 1));
  }, [clearConflicts, offlineUsername]);
  const syncNotice = useSyncRetryNotice({
    id: "sync:drive",
    active: offlineEnabled && outboxNoticeActive,
    title: driveLabels.syncFailedNotice,
    retryLabel: driveLabels.retrySync,
    onRetry: retryFailedOutbox,
  });
  useDriveFileNodeInbound(offlineEnabled ? offlineUsername : null, outboxNoticeKey);

  useOfflineSyncToast(syncing, driveLabels.toastSynced);
  const uploadCounts = useMemo(
    () =>
      uploadModel
        ? {
            count: uploadModel.snapshot.items.length,
            failed: uploadModel.failedCount,
            paused: uploadModel.snapshot.state === "paused_server_full",
          }
        : null,
    [uploadModel],
  );
  const projectScope = useDriveProjectScope({
    view: controller.view,
    groupRoots: controller.sidebarGroupRoots,
    selectView: controller.selectView,
  });
  const { projects } = useProjects();
  const teamDriveRoots = useMemo(
    () => projectScope.groupRoots.filter((root) => !isProjectFolderUiPath(root.path, projects)),
    [projectScope.groupRoots, projects],
  );
  const selectedProjectIds = useSelectedProjectIds();
  const { primarySidebarItems, groupSidebarItems, projectSidebarItems } = useDriveSidebarModel({
    projects,
    selectedProjectIds,
    labels: controller.labels,
    view: controller.view,
    uploads: uploadCounts,
    // Project folders are listed under Projects only, never as Team Drives rows.
    sidebarGroupRoots: teamDriveRoots,
    hidePersonalDrive: projectScope.hidePersonalDrive,
    selectView: controller.selectView,
    sidebarDropZoneProps: controller.sidebarDropZoneProps,
    commitMoveToFolder: controller.commitMoveToFolder,
  });

  // Search stays on offline: it filters names in the local file tree (#2063 C3).
  const browserTitleContext = controller.searchQuery.trim()
    ? controller.labels.searchViewTitle
    : controller.viewLabel;
  useDocumentTitle(browserTitleContext);

  const detailLayout = useDocsCommentsLayout();
  const useDetailDrawer = detailLayout === "drawer";
  const {
    labels,
    active,
    detailOpen,
    setDetailOpen,
    starred,
    inTrashView,
    filePreviews,
    richPreviews,
    toggleStar,
    requestRenameItem,
    requestMoveItem,
    isUnderTrash,
    setConfirmDelete,
    structureEnabled,
    selectedIds,
    selectionBarButtons,
    folderPickerRootLabels,
  } = controller;

  const handleDetailClose = useCallback(() => {
    setDetailOpen(false);
  }, [setDetailOpen]);

  const activePreview = active
    ? resolveDetailFilePreview(filePreviews, richPreviews, active.id)
    : undefined;

  /** Open when toggled — empty placeholder if no file (like invitations/review). */
  const detailPanelOpen = detailOpen;
  const shareEnabled = Boolean(shareOperations);

  const detailPanel = useMemo(() => {
    const selection = {
      selectedCount: selectedIds.length,
      selectionActions: selectionBarButtons,
    };
    if (!active) {
      return (
        <DriveDetailPanel labels={labels} file={null} onClose={handleDetailClose} {...selection} />
      );
    }
    return (
      <DriveDetailPanel
        {...selection}
        labels={labels}
        file={active}
        locationLabel={driveItemLocationLabel(active, labels, folderPickerRootLabels)}
        preview={activePreview}
        isStarred={!!starred[active.id]}
        inTrash={inTrashView}
        onClose={handleDetailClose}
        onDownload={() =>
          startDriveItemDownload(operations, active, showError, () =>
            show("Download started", { icon: <Download className="size-4" /> }),
          )
        }
        onStar={() => toggleStar(active.id)}
        onRename={() => requestRenameItem(active)}
        onMove={() => requestMoveItem(active)}
        onDelete={() =>
          isUnderTrash(active.parent)
            ? setConfirmDelete({ ids: [active.id], permanent: true })
            : setConfirmDelete({ ids: [active.id], permanent: false })
        }
        canShare={
          shareEnabled &&
          !inTrashView &&
          Boolean(active.apiPath?.trim()) &&
          !isTopLevelDriveApiPath(active.apiPath) &&
          activeMayShare === true
        }
        canManageStructure={
          structureEnabled &&
          !projectFolders.isProjectFolder(active) &&
          resolveDriveFileCanManageStructure(active.mayManageStructure, {
            isActive: true,
            activeMayManageStructure,
          })
        }
        onShare={
          shareEnabled && active.apiPath
            ? () => handleOpenShareForFile(active.apiPath!, active.title)
            : undefined
        }
      />
    );
  }, [
    active,
    projectFolders,
    folderPickerRootLabels,
    selectedIds.length,
    selectionBarButtons,
    activeMayManageStructure,
    activeMayShare,
    activePreview,
    handleDetailClose,
    handleOpenShareForFile,
    inTrashView,
    isUnderTrash,
    labels,
    operations,
    requestMoveItem,
    requestRenameItem,
    setConfirmDelete,
    shareEnabled,
    show,
    showError,
    starred,
    structureEnabled,
    toggleStar,
  ]);

  return (
    <TooltipProvider delayDuration={300}>
      <DriveFolderDownloadContext.Provider value={Boolean(operations?.downloadFolder)}>
        <DriveUploadQueueProvider value={uploadModel}>
          <WorkspaceAppLayout
            className={cn(
              "drive-workspace",
              detailPanelOpen && "drive-workspace--panel-open",
              className,
            )}
            sidebar={
              <DriveSidebar
                controller={controller}
                session={session}
                onLogout={onLogout}
                onOpenDocsFile={onOpenDocsFile}
                primarySidebarItems={primarySidebarItems}
                groupSidebarItems={groupSidebarItems}
                projectSidebarItems={projectSidebarItems}
              />
            }
            mainHeader={<DriveMainHeader controller={controller} />}
            mainNotice={<NoticeBar label={driveLabels.noticeBarLabel} notices={[syncNotice]} />}
            main={
              <DriveMainPane
                controller={controller}
                operations={operations}
                openFile={guardedOpenFile}
                offlineEnabled={offlineEnabled}
                offlineAvailableIds={rowOfflineAvailableIds}
                offlinePendingSyncIds={rowOfflinePendingSyncIds}
                onMakeOfflineAvailable={handleMakeOfflineAvailable}
                pinLoadingId={pinLoadingId}
                extraFileActions={fileExtraActions}
                shareEnabled={shareEnabled}
                onOpenShare={handleOpenShareForFile}
                activeMayShare={activeMayShare}
                activeMayManageStructure={activeMayManageStructure}
              />
            }
            panel={
              useDetailDrawer ? undefined : (
                <div
                  className="workspace-app-layout__panel drive-workspace__detail-panel"
                  data-open={detailPanelOpen ? "true" : "false"}
                  aria-hidden={!detailPanelOpen}
                  inert={!detailPanelOpen || undefined}
                >
                  {detailPanel}
                </div>
              )
            }
          />
          {useDetailDrawer ? (
            <SideDrawer
              open={detailPanelOpen}
              onClose={handleDetailClose}
              title={labels.detailSidebarTitle}
              className={`${DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS} drive-detail-panel-drawer`}
            >
              {detailPanel}
            </SideDrawer>
          ) : null}
          <DriveWorkspaceModals
            controller={controller}
            shareOperations={shareOperations}
            shareDialog={shareDialog}
          />
          {saveAsMarkdown?.dialogs}
          {controller.uploadEnabled ? (
            <input
              ref={controller.fileInputRef}
              type="file"
              multiple
              className="hidden"
              aria-label={labels.uploadFiles}
              onChange={(e) => {
                controller.handleUpload(e.target.files);
                e.target.value = "";
              }}
            />
          ) : null}
          {controller.canUploadFolders ? (
            <input
              ref={controller.folderInputRef}
              type="file"
              // A folder with all its subfolders (#1620); React has no prop for it.
              {...{ webkitdirectory: "" }}
              className="hidden"
              aria-label={labels.uploadFolder}
              onChange={(e) => {
                controller.handleUploadFolder(e.target.files);
                e.target.value = "";
              }}
            />
          ) : null}
          {chooseUploadFolder.dialog}
          <DriveUploadAnnouncer snapshot={uploadQueue} />
        </DriveUploadQueueProvider>
      </DriveFolderDownloadContext.Provider>
    </TooltipProvider>
  );
}

type DriveController = ReturnType<typeof useDriveController>;

function DriveSidebar({
  controller,
  session,
  onLogout,
  onOpenDocsFile,
  primarySidebarItems,
  groupSidebarItems,
  projectSidebarItems,
}: {
  controller: DriveController;
  session: WorkspaceSession;
  onLogout?: () => void;
  onOpenDocsFile?: (apiPath: string) => void;
  primarySidebarItems: ReturnType<typeof useDriveSidebarModel>["primarySidebarItems"];
  groupSidebarItems: ReturnType<typeof useDriveSidebarModel>["groupSidebarItems"];
  projectSidebarItems: ReturnType<typeof useDriveSidebarModel>["projectSidebarItems"];
}) {
  const {
    labels,
    sidebarOpen,
    setSidebarOpen,
    createFolder,
    createMarkdown,
    fileInputRef,
    folderInputRef,
    canUploadFolders,
    uploadEnabled,
    structureEnabled,
  } = controller;

  return (
    <AppSidebar
      settingsAppId="drive"
      open={sidebarOpen}
      onCloseMobile={() => setSidebarOpen(false)}
      appSwitchDisabled={wgwIsGuestSession()}
      footer={
        <WorkspaceSidebarAccountFooter
          session={session}
          detailLine={workspaceUserFooterDetailLine(session, wgwIsGuestSession(), uploadEnabled)}
          onLogout={onLogout}
        />
      }
      primaryButton={
        // New folder is the menu's main action. Guests cannot create folders or
        // files (#1712); a guest on a link that allows uploads gets Upload (#1715).
        structureEnabled || uploadEnabled ? (
          <DriveNewMenu
            labels={labels}
            onCreateFolder={structureEnabled ? createFolder : undefined}
            onUploadFiles={uploadEnabled ? () => fileInputRef.current?.click() : undefined}
            onUploadFolder={canUploadFolders ? () => folderInputRef.current?.click() : undefined}
            onCreateMarkdown={
              structureEnabled && uploadEnabled && onOpenDocsFile ? createMarkdown : undefined
            }
          />
        ) : null
      }
    >
      <SidebarSection items={primarySidebarItems} />
      {groupSidebarItems.length > 0 ? (
        <SidebarSection title={labels.sidebarSharedDrives} items={groupSidebarItems} />
      ) : null}
      {projectSidebarItems.length > 0 ? (
        <SidebarSection title={labels.sidebarProjects} items={projectSidebarItems} />
      ) : null}
    </AppSidebar>
  );
}

function DriveMainHeader({ controller }: { controller: DriveController }) {
  const projectFolders = useProjectFolders();
  const {
    labels,
    sidebarOpen,
    setSidebarOpen,
    viewLabel,
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    detailOpen,
    setDetailOpen,
    breadcrumbs,
    selectView,
    view,
  } = controller;

  // The folder path lives in the header: parent folders lead, the open folder is the title.
  const searching = searchQuery.trim() !== "";
  const trail = !searching && breadcrumbs.length > 1 ? breadcrumbs.slice(0, -1) : [];
  const title = searching
    ? labels.searchViewTitle
    : trail.length > 0
      ? breadcrumbs[breadcrumbs.length - 1].label
      : viewLabel;

  return (
    <ViewHeader
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen((v) => !v)}
      title={title}
      titlePrefix={
        trail.length > 0 ? (
          <span className="drive-main-header__trail">
            <PathBreadcrumb
              items={withDriveRootIcons(trail, projectFolders.isProjectFolderUiPath)}
              currentPath={view.type === "folder" ? view.path : undefined}
              onNavigate={(path) => selectView({ type: "folder", path })}
            />
            <ChevronRight className="drive-main-header__trail-separator" aria-hidden />
          </span>
        ) : undefined
      }
      searchPlaceholder={labels.searchPlaceholder}
      searchValue={searchQuery}
      onSearchInput={setSearchQuery}
      searchInputRef={searchInputRef}
      actions={
        <div className="drive-main-header__actions">
          <ViewModeToggle
            value={viewMode}
            onChange={setViewMode}
            gridLabel={labels.gridView}
            listLabel={labels.listView}
          />
          <IconButton
            label={labels.detailPanelToggle}
            icon={<PanelRight className="size-4" aria-hidden />}
            size="md"
            variant="outline"
            active={detailOpen}
            onClick={() => setDetailOpen((open) => !open)}
          />
        </div>
      }
    />
  );
}
