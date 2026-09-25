import type { ReactNode } from "react";
import { Clock, Plus, Share, Star, Trash2 } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { Button } from "@/button/src/button";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { workspaceUserInitials, type WorkspaceSession } from "@/lib/workspace/workspace-session";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";
import { cn } from "@/lib/utils";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { DocsHomePane } from "@/docs-core/src/docs-home-pane";
import { DocsHomeModals } from "@/docs-core/src/docs-home-modals";
import type { DocsHomeActions } from "@/docs-core/src/use-docs-home-actions";
import type { DocsHomeCreateDialogState } from "@/docs-core/src/use-docs-home-create-dialog";
import type { DocsHomeEmptyIconKind } from "@/docs-core/src/docs-home-workspace-model";
import type { DocsHomeGroupRoot } from "@/docs-core/src/docs-home-drives";
import type { DriveAPIOperations, DriveShareOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { ViewMode } from "@/view-mode-toggle/src/view-mode-toggle";

export type DocsHomeWorkspaceFrameProps = {
  className?: string;
  session: WorkspaceSession;
  onLogout?: () => void;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  onToggleSidebar: () => void;
  showNewDocument: boolean;
  primaryItems: MenuItemProps[];
  driveItems: MenuItemProps[];
  labels: DocsUILabels;
  headerTitle: string;
  emptyMessage: string;
  emptyIconKind: DocsHomeEmptyIconKind | null;
  syncingOffline: boolean;
  visibleFiles: DriveFile[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  offlinePendingSyncIds: ReadonlySet<string>;
  query: string;
  onQueryChange: (query: string) => void;
  searchEnabled: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onLoadMore: () => void;
  onOpenFile: (file: DriveFile) => void;
  actions: DocsHomeActions;
  inTrashView: boolean;
  operations?: DriveAPIOperations;
  shareOperations?: DriveShareOperations;
  username: string;
  labeledGroupRoots: readonly DocsHomeGroupRoot[];
  files: DriveFile[];
  createDialog: DocsHomeCreateDialogState;
};

function docsHomeEmptyIcon(kind: DocsHomeEmptyIconKind | null): ReactNode {
  if (kind === "share") return <Share className="size-12" />;
  if (kind === "clock") return <Clock className="size-12" />;
  if (kind === "star") return <Star className="size-12" />;
  if (kind === "trash") return <Trash2 className="size-12" />;
  return undefined;
}

/** Sidebar, document list, and home dialogs. State stays in `DocsHomeWorkspace`. */
export function DocsHomeWorkspaceFrame({
  className,
  session,
  onLogout,
  sidebarOpen,
  onCloseSidebar,
  onToggleSidebar,
  showNewDocument,
  primaryItems,
  driveItems,
  labels,
  headerTitle,
  emptyMessage,
  emptyIconKind,
  syncingOffline,
  visibleFiles,
  loading,
  loadingMore,
  hasMore,
  error,
  offlinePendingSyncIds,
  query,
  onQueryChange,
  searchEnabled,
  viewMode,
  onViewModeChange,
  onLoadMore,
  onOpenFile,
  actions,
  inTrashView,
  operations,
  shareOperations,
  username,
  labeledGroupRoots,
  files,
  createDialog,
}: DocsHomeWorkspaceFrameProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <WorkspaceAppLayout
        className={cn("docs-workspace docs-home-workspace", className)}
        sidebar={
          <AppSidebar
            open={sidebarOpen}
            onCloseMobile={onCloseSidebar}
            appSwitchDisabled={wgwIsGuestSession()}
            appSwitchSubtitle="Docs"
            primaryButton={
              showNewDocument ? (
                <Button
                  label={labels.homeNewDocument}
                  icon={<Plus />}
                  size="xl"
                  pill
                  variant="primary"
                  className="w-full"
                  onClick={createDialog.handleCreateDocument}
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
            emptyIcon={docsHomeEmptyIcon(emptyIconKind)}
            files={visibleFiles}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            error={error}
            offlinePendingSyncIds={offlinePendingSyncIds}
            offlineLabels={{
              ...labels,
              offlinePendingSync: syncingOffline
                ? labels.syncingOffline
                : labels.offlinePendingSync,
            }}
            query={query}
            onQueryChange={onQueryChange}
            searchEnabled={searchEnabled}
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            onLoadMore={onLoadMore}
            onOpenFile={onOpenFile}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={onToggleSidebar}
            starred={actions.starred}
            onStar={actions.onStar}
            onDownload={actions.onDownload}
            onRename={actions.onRename}
            onMove={actions.onMove}
            onTrash={actions.onTrash}
            inTrashView={inTrashView}
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
        createDialogOpen={createDialog.createDialogOpen}
        createDialogDefaultName={createDialog.createDialogDefaultName}
        createDialogBrowsePath={createDialog.createDialogBrowsePath}
        createDialogView={createDialog.createDialogView}
        onCloseCreateDialog={createDialog.closeCreateDialog}
        onConfirmCreateDocument={createDialog.confirmCreateDocument}
      />
    </TooltipProvider>
  );
}
