import { TooltipProvider } from "@/ui/tooltip";
import { useCallback, useEffect, useMemo } from "react";
import { PanelRight } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import {
  workspaceUserFooterDetailLine,
  workspaceUserInitials,
  type WorkspaceSession,
} from "@/lib/workspace/workspace-session";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";
import { ViewHeader } from "@/view-header/src/view-header";
import { ViewModeToggle } from "@/view-mode-toggle/src/view-mode-toggle";
import { cn } from "@/lib/utils";
import { SideDrawer } from "@/ui/side-drawer";
import { DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS } from "@/text-editor-core/docs-collab/docs-collab-card";
import { useDocsCommentsLayout } from "@/text-editor-core/docs-collab/use-docs-comments-layout";
import { DriveDetailPanel } from "@/drive-core/src/drive-detail-panel";
import { DriveMainPane } from "@/drive-core/src/drive-main-pane";
import { DriveNewMenu } from "@/drive-core/src/drive-new-menu";
import { UnifiedSearchApiDropdown } from "@/unified-search-dropdown/src/unified-search-api-dropdown";
import { useDriveController } from "@/drive-core/src/use-drive-controller";
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
import { getDriveSyncRunner } from "@/lib/offline/drive/drive-hybrid-operations";
import { useOfflineReconnectFlush } from "@/lib/offline/use-offline-reconnect-flush";
import { useOfflineSyncToast } from "@/lib/offline/use-offline-sync-toast";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { isTopLevelDriveApiPath } from "@/drive-core/src/drive-path-utils";
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
  onNavigate,
  onOpenShare,
  onLogout,
  className,
}: DriveWorkspaceProps) {
  const { showError } = useAppToast();
  const { online } = useConnectivity();
  const offlineEnabled = Boolean(offlineUsername);
  const searchEnabled = !offlineEnabled || online;

  const controller = useDriveController({
    data,
    session,
    operations,
    shareOperations,
    listLoading,
    view,
    onViewChange,
    onOpenDocsFile,
    onNavigate,
  });

  const shareDialog = useDriveShareDialog({
    shareOperations,
    username: controller.currentUsername,
  });

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
      shareDialog.openShareDialog(apiPath, title);
      onOpenShare?.(apiPath);
    },
    [onOpenShare, shareDialog],
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

  const handleMakeOfflineAvailable = useCallback(
    (file: DriveFile) => {
      void pinOfflineFile(file);
    },
    [pinOfflineFile],
  );

  const guardedOpenFile = useCallback(
    (file: DriveFile) => {
      if (!canOpenOffline(file)) {
        showError("This file is not available offline. Make it available while online.");
        return;
      }
      controller.openFile(file);
    },
    [canOpenOffline, controller, showError],
  );

  const syncing = useOfflineReconnectFlush({
    enabled: offlineEnabled,
    flush: async () => {
      if (!offlineUsername) return;
      await getDriveSyncRunner(offlineUsername).flush();
    },
    afterFlush: refresh,
  });

  useOfflineSyncToast(syncing, "Changes synced");
  const { primarySidebarItems, groupSidebarItems } = useDriveSidebarModel({
    labels: controller.labels,
    view: controller.view,
    sidebarGroupPaths: controller.sidebarGroupPaths,
    selectView: controller.selectView,
    sidebarDropZoneProps: controller.sidebarDropZoneProps,
    commitMoveToFolder: controller.commitMoveToFolder,
  });

  const { searchQuery, setSearchQuery } = controller;

  useEffect(() => {
    if (!searchEnabled && searchQuery) setSearchQuery("");
  }, [searchEnabled, searchQuery, setSearchQuery]);

  const browserTitleContext =
    searchEnabled && searchQuery.trim() ? controller.labels.searchViewTitle : controller.viewLabel;
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
    if (!active) {
      return <DriveDetailPanel labels={labels} file={null} onClose={handleDetailClose} />;
    }
    return (
      <DriveDetailPanel
        labels={labels}
        file={active}
        preview={activePreview}
        isStarred={!!starred[active.id]}
        inTrash={inTrashView}
        onClose={handleDetailClose}
        onDownload={() => {
          if (operations && active.apiPath && active.kind !== "folder") {
            void operations.downloadFile(active.apiPath).catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              showError(message);
            });
          }
        }}
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
        canManageStructure={resolveDriveFileCanManageStructure(active.mayManageStructure, {
          isActive: true,
          activeMayManageStructure,
        })}
        onShare={
          shareEnabled && active.apiPath
            ? () => handleOpenShareForFile(active.apiPath!, active.title)
            : undefined
        }
      />
    );
  }, [
    active,
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
    showError,
    starred,
    toggleStar,
  ]);

  return (
    <TooltipProvider delayDuration={300}>
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
          />
        }
        mainHeader={
          <DriveMainHeader
            controller={controller}
            unifiedSearchEnabled={Boolean(operations)}
            searchEnabled={searchEnabled}
          />
        }
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
            extraFileActions={offlineEnabled ? extraFileActions : undefined}
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
      <input
        ref={controller.fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          controller.handleUpload(e.target.files);
          e.target.value = "";
        }}
      />
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
}: {
  controller: DriveController;
  session: WorkspaceSession;
  onLogout?: () => void;
  onOpenDocsFile?: (apiPath: string) => void;
  primarySidebarItems: ReturnType<typeof useDriveSidebarModel>["primarySidebarItems"];
  groupSidebarItems: ReturnType<typeof useDriveSidebarModel>["groupSidebarItems"];
}) {
  const {
    labels,
    sidebarOpen,
    setSidebarOpen,
    createFolder,
    createMarkdown,
    createFromTemplate,
    newFileTemplates,
    fileInputRef,
  } = controller;

  return (
    <AppSidebar
      open={sidebarOpen}
      onCloseMobile={() => setSidebarOpen(false)}
      appSwitchDisabled={wgwIsGuestSession()}
      footer={
        <WorkspaceUserFooter
          name={session.user.displayName}
          initials={workspaceUserInitials(session.user)}
          detailLine={workspaceUserFooterDetailLine(session, wgwIsGuestSession())}
          onLogoutClick={onLogout}
        />
      }
      primaryButton={
        <DriveNewMenu
          labels={labels}
          onCreateFolder={createFolder}
          onUploadFiles={() => fileInputRef.current?.click()}
          onCreateMarkdown={onOpenDocsFile ? createMarkdown : undefined}
          newFileTemplates={newFileTemplates}
          onCreateTemplate={createFromTemplate}
        />
      }
    >
      <SidebarSection items={primarySidebarItems} />
      {groupSidebarItems.length > 0 ? (
        <SidebarSection title={labels.sidebarSharedDrives} items={groupSidebarItems} />
      ) : null}
    </AppSidebar>
  );
}

function DriveMainHeader({
  controller,
  unifiedSearchEnabled,
  searchEnabled,
}: {
  controller: DriveController;
  unifiedSearchEnabled: boolean;
  searchEnabled: boolean;
}) {
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
    handleUnifiedSearchSelect,
    detailOpen,
    setDetailOpen,
  } = controller;

  return (
    <ViewHeader
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen((v) => !v)}
      title={searchEnabled && searchQuery.trim() ? labels.searchViewTitle : viewLabel}
      searchPlaceholder={searchEnabled ? labels.searchPlaceholder : undefined}
      searchValue={searchEnabled ? searchQuery : undefined}
      onSearchInput={searchEnabled ? setSearchQuery : undefined}
      searchInputRef={searchInputRef}
      searchContent={
        searchEnabled && unifiedSearchEnabled ? (
          <UnifiedSearchApiDropdown
            className="drive-main-header__search-dropdown anchored-dropdown-panel"
            query={searchQuery}
            limit={10}
            onSelect={handleUnifiedSearchSelect}
          />
        ) : null
      }
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
            size="sm"
            variant="outline"
            active={detailOpen}
            onClick={() => setDetailOpen((open) => !open)}
          />
        </div>
      }
    />
  );
}
