import { useEffect, useMemo, useState, type TransitionEvent } from "react";
import { Cloud, Download } from "lucide-react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { DriveViewIcon } from "@/drive-core/src/drive-view-icons";
import { useAppToast } from "@/hooks/use-app-toast";
import { CollectionState } from "@/collection-state/src/collection-state";
import { FileDropOverlay } from "@/file-drop-overlay/src/file-drop-overlay";
import { PathBreadcrumb } from "@/path-breadcrumb/src/path-breadcrumb";
import { UploadProgress } from "@/upload-progress/src/upload-progress";
import { cn } from "@/lib/utils";
import { DriveDetailPanel, DriveGridView, DriveListView } from "@/drive-core/src/drive-browser";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";
import {
  resolveDetailFilePreview,
  resolveGridFilePreview,
} from "@/lib/file-preview/file-preview-utils";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import type { useDriveController } from "@/drive-core/src/use-drive-controller";
import { isTopLevelDriveApiPath } from "@/drive-core/src/drive-path-utils";
import { resolveDriveFileCanManageStructure } from "@/drive-core/src/drive-file-structure-rights";

type DriveController = ReturnType<typeof useDriveController>;

export type DriveMainPaneProps = {
  controller: DriveController;
  operations?: DriveAPIOperations;
  openFile?: (file: DriveFile) => void;
  offlineEnabled?: boolean;
  offlineAvailableIds?: ReadonlySet<string>;
  offlinePendingSyncIds?: ReadonlySet<string>;
  onMakeOfflineAvailable?: (file: DriveFile) => void;
  pinLoadingId?: string | null;
  extraFileActions?: (file: DriveFile) => ActionBarAction[];
  shareEnabled?: boolean;
  onOpenShare?: (apiPath: string, title: string) => void;
  activeMayShare?: boolean;
  activeMayManageStructure?: boolean;
};

export function DriveMainPane({
  controller,
  operations,
  openFile: openFileOverride,
  offlineEnabled = false,
  offlineAvailableIds,
  offlinePendingSyncIds,
  onMakeOfflineAvailable,
  pinLoadingId,
  extraFileActions,
  shareEnabled = false,
  onOpenShare,
  activeMayShare,
  activeMayManageStructure,
}: DriveMainPaneProps) {
  const {
    labels,
    view,
    dropUploadActive,
    setDropUploadActive,
    handleUpload,
    breadcrumbs,
    selectView,
    visibleItems,
    viewMode,
    filePreviews,
    richPreviews,
    selectedIds,
    starred,
    selectionMode,
    isTouch,
    handleSelect,
    openFile,
    enterSelectionFor,
    toggleStar,
    requestDeleteItem,
    requestRenameItem,
    requestMoveItem,
    isItemDragging,
    itemDragHandlers,
    folderDropZoneProps,
    activeId,
    inTrashView,
    detailOpen,
    active,
    setDetailOpen,
    isUnderTrash,
    setConfirmDelete,
    selectionBar,
    searchQuery,
    uploadProgress,
    folderListingPending,
    listLoading,
  } = controller;

  const showFolderListingBusy =
    view.type === "folder" && !searchQuery.trim() && (folderListingPending || listLoading);

  const { show, showError } = useAppToast();
  const { online } = useConnectivity();

  const handleDownload = (file: DriveFile) => {
    if (operations && file.apiPath && file.kind !== "folder") {
      void operations.downloadFile(file.apiPath).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        showError(message);
      });
    }
    show("Download started", { icon: <Download className="size-4" /> });
  };

  const searchActive = Boolean(searchQuery.trim());

  const handleShare = (file: DriveFile) => {
    if (!file.apiPath || !onOpenShare) return;
    onOpenShare(file.apiPath, file.title);
  };

  const fileCanShare = (file: DriveFile) => {
    if (!shareEnabled || inTrashView || !file.apiPath?.trim()) return false;
    if (isTopLevelDriveApiPath(file.apiPath)) return false;
    const resolvedMayShare = file.id === active?.id ? activeMayShare : file.mayShare;
    return resolvedMayShare === true;
  };

  const fileCanManageStructure = (file: DriveFile) =>
    resolveDriveFileCanManageStructure(file.mayManageStructure, {
      isActive: file.id === active?.id,
      activeMayManageStructure,
    });

  const sharedBrowserProps = {
    items: visibleItems,
    selectedIds,
    starred,
    labels,
    searchActive,
    inTrash: inTrashView,
    selectionMode,
    isTouch,
    isItemDragging,
    itemDragHandlers,
    folderDropZoneProps,
    onSelect: handleSelect,
    onOpen: openFileOverride ?? openFile,
    onLongPress: enterSelectionFor,
    onStar: toggleStar,
    onDownload: handleDownload,
    onRename: requestRenameItem,
    onMove: requestMoveItem,
    onTrash: requestDeleteItem,
    onShare: shareEnabled ? handleShare : undefined,
    fileCanShare: shareEnabled ? fileCanShare : undefined,
    fileCanManageStructure,
    offlineEnabled,
    offlineAvailableIds,
    offlinePendingSyncIds,
    onMakeOfflineAvailable,
    canPinOffline: online,
    pinLoadingId,
    extraFileActions,
    offlineBadgeLabels: {
      offlineAvailable: labels.offlineAvailable,
      offlinePendingSync: labels.offlinePendingSync,
    },
  };

  const gridFilePreviews = useMemo(() => {
    const merged: Record<string, FilePreviewPayload> = {};
    for (const file of visibleItems) {
      const resolved = resolveGridFilePreview(filePreviews, richPreviews, file.id);
      if (resolved) merged[file.id] = resolved;
    }
    return merged;
  }, [filePreviews, richPreviews, visibleItems]);

  const gridBrowserProps = { ...sharedBrowserProps, filePreviews: gridFilePreviews };

  const dropTargetLabel =
    view.type === "folder"
      ? view.path.split("/").pop() || labels.sidebarMyDrive
      : labels.sidebarMyDrive;

  const showMobileDetail = Boolean(detailOpen && active);
  const showMobileDetailOverlay = showMobileDetail;
  const showDesktopDetailAside = Boolean(active);
  const desktopDetailOpen = Boolean(detailOpen && active);
  const [mobileOverlayMount, setMobileOverlayMount] = useState(false);
  const [mobileOverlayVisible, setMobileOverlayVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setMobileOverlayMount(false);
      setMobileOverlayVisible(false);
      return;
    }
    if (!showMobileDetailOverlay) {
      setMobileOverlayVisible(false);
      return;
    }
    setMobileOverlayMount(true);
    let innerFrame: number | undefined;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => setMobileOverlayVisible(true));
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame !== undefined) cancelAnimationFrame(innerFrame);
    };
  }, [showMobileDetailOverlay, active]);

  const handleMobileOverlayTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== "transform") return;
    if (!mobileOverlayVisible) {
      setMobileOverlayMount(false);
    }
  };

  const handleDetailClose = () => {
    setDetailOpen(false);
  };

  const activePreview = active
    ? resolveDetailFilePreview(filePreviews, richPreviews, active.id)
    : undefined;

  return (
    <section
      className={cn(
        "drive-main-pane",
        mobileOverlayVisible && "drive-main-pane--mobile-detail-open",
      )}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropUploadActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropUploadActive(false);
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropUploadActive(false);
        handleUpload(event.dataTransfer.files);
      }}
    >
      {dropUploadActive ? (
        <FileDropOverlay>
          {labels.dropUploadHint} {dropTargetLabel}
        </FileDropOverlay>
      ) : null}

      {searchQuery.trim() ? null : (
        <PathBreadcrumb
          className="drive-main-pane__breadcrumbs"
          leadingIcon={<DriveViewIcon view={view} className="size-[1.125rem]" />}
          items={breadcrumbs}
          currentPath={view.type === "folder" ? view.path : undefined}
          onNavigate={(path) => selectView({ type: "folder", path })}
        />
      )}

      <div className="drive-main-pane__body">
        <div className="drive-main-pane__scroll">
          {showFolderListingBusy ? (
            <CollectionState variant="loading">{labels.folderListingLoading}</CollectionState>
          ) : visibleItems.length === 0 ? (
            <CollectionState icon={<Cloud className="size-12" />}>
              {labels.emptyFolder}
            </CollectionState>
          ) : viewMode === "grid" ? (
            <DriveGridView {...gridBrowserProps} />
          ) : (
            <DriveListView {...sharedBrowserProps} activeId={activeId} />
          )}
        </div>

        {showDesktopDetailAside && active ? (
          <aside
            className="drive-detail-aside"
            data-open={desktopDetailOpen ? "true" : "false"}
            inert={desktopDetailOpen ? undefined : true}
          >
            <DriveDetailPanel
              {...buildDetailPanelProps({
                labels,
                file: active,
                preview: activePreview,
                isStarred: !!starred[active.id],
                inTrash: inTrashView,
                operations,
                showError,
                onClose: handleDetailClose,
                onStar: () => toggleStar(active.id),
                onRename: () => requestRenameItem(active),
                onMove: () => requestMoveItem(active),
                onDelete: () =>
                  isUnderTrash(active.parent)
                    ? setConfirmDelete({ ids: [active.id], permanent: true })
                    : setConfirmDelete({ ids: [active.id], permanent: false }),
                canShare:
                  shareEnabled &&
                  !inTrashView &&
                  Boolean(active.apiPath?.trim()) &&
                  !isTopLevelDriveApiPath(active.apiPath) &&
                  activeMayShare === true,
                canManageStructure: resolveDriveFileCanManageStructure(active.mayManageStructure, {
                  isActive: true,
                  activeMayManageStructure,
                }),
                onShare:
                  shareEnabled && active.apiPath && onOpenShare
                    ? () => onOpenShare(active.apiPath!, active.title)
                    : undefined,
              })}
            />
          </aside>
        ) : null}
      </div>

      {mobileOverlayMount && active ? (
        <div
          className={cn(
            "drive-detail-overlay",
            mobileOverlayVisible ? "translate-x-0" : "translate-x-full",
          )}
          onTransitionEnd={handleMobileOverlayTransitionEnd}
        >
          <DriveDetailPanel
            {...buildDetailPanelProps({
              labels,
              file: active,
              preview: activePreview,
              isStarred: !!starred[active.id],
              inTrash: inTrashView,
              operations,
              showError,
              onClose: handleDetailClose,
              onStar: () => toggleStar(active.id),
              onRename: () => requestRenameItem(active),
              onMove: () => requestMoveItem(active),
              onDelete: () =>
                isUnderTrash(active.parent)
                  ? setConfirmDelete({ ids: [active.id], permanent: true })
                  : setConfirmDelete({ ids: [active.id], permanent: false }),
              canShare:
                shareEnabled &&
                !inTrashView &&
                Boolean(active.apiPath?.trim()) &&
                !isTopLevelDriveApiPath(active.apiPath) &&
                activeMayShare === true,
              canManageStructure: resolveDriveFileCanManageStructure(active.mayManageStructure, {
                isActive: true,
                activeMayManageStructure,
              }),
              onShare:
                shareEnabled && active.apiPath && onOpenShare
                  ? () => onOpenShare(active.apiPath!, active.title)
                  : undefined,
              mobile: true,
            })}
          />
        </div>
      ) : null}

      {uploadProgress ? (
        <div className="drive-floating-upload">
          <UploadProgress
            label={uploadProgress.label}
            percent={uploadProgress.percent}
            detail={uploadProgress.detail}
            done={uploadProgress.done}
          />
        </div>
      ) : null}

      {selectionBar}
    </section>
  );
}

function buildDetailPanelProps({
  labels,
  file,
  preview,
  isStarred,
  inTrash,
  operations,
  showError,
  onClose,
  onStar,
  onRename,
  onMove,
  onDelete,
  canShare,
  canManageStructure,
  onShare,
  mobile,
}: {
  labels: DriveUILabels;
  file: DriveFile;
  preview?: FilePreviewPayload;
  isStarred: boolean;
  inTrash: boolean;
  operations?: DriveAPIOperations;
  showError: (message: string) => void;
  onClose: () => void;
  onStar: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  canShare?: boolean;
  canManageStructure?: boolean;
  onShare?: () => void;
  mobile?: boolean;
}) {
  return {
    labels,
    file,
    preview,
    isStarred,
    inTrash,
    onClose,
    onStar,
    onRename,
    onMove,
    onDelete,
    canShare,
    canManageStructure,
    onShare,
    mobile,
    onDownload: () => {
      if (operations && file.apiPath && file.kind !== "folder") {
        void operations.downloadFile(file.apiPath).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          showError(message);
        });
      }
    },
  };
}
